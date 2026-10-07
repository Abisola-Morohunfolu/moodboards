import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import sharp from 'sharp';
import { R2Storage } from '@moodboard/storage';
import {
  assetUrlResponseSchema,
  boardDetailResponseSchema,
  contactParticipantResponseSchema,
  clientResponseSchema,
  contactResponseSchema,
  contactLinkResponseSchema,
  itemListResponseSchema,
  shareResponseSchema,
  clientApprovalListSchema,
  plannerApprovalListSchema,
  decisionResponseSchema,
} from '@moodboard/contracts';
import { DataSource } from 'typeorm';
import { AppModule } from '../apps/api/src/app.module';
import { configureHttp } from '../apps/api/src/app.setup';
import { CONTACT_COOKIE, SESSION_COOKIE } from '../apps/api/src/features/auth/cookies';
import { BoardEventWriter } from '../apps/api/src/platform/events/board-event.writer';
import { RedisRateLimitStore } from '../apps/api/src/features/auth/redis-rate-limit.store';
import { MediaStorage } from '../apps/api/src/platform/storage/storage.module';
import { MediaProcessors } from '../apps/worker/src/jobs/processors';
import { testDatabaseUrl, testDataSource } from './database';
import { testRateLimitStore, testRedisUrl } from './redis';
import { testStorage } from './storage';

describe('Board-specific contact HTTP workflow', () => {
  const source = testDataSource(10);
  const store = testRateLimitStore();
  const originalEnvironment = { ...process.env };
  let app: INestApplication;
  let storage: R2Storage;
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    await store.client.connect();
    storage = await testStorage();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          DATABASE_URL: testDatabaseUrl(),
          REDIS_URL: testRedisUrl(),
          LINK_SECRET: 'x'.repeat(64),
          PUBLIC_API_URL: 'http://127.0.0.1:3001',
        }),
      ],
    })
      .overrideProvider(DataSource)
      .useValue(source)
      .overrideProvider(RedisRateLimitStore)
      .useValue(store)
      .overrideProvider(MediaStorage)
      .useValue({
        storage,
        maxBytes: storage.config.MEDIA_UPLOAD_MAX_BYTES,
        require: () => storage,
      })
      .compile();
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'LINK_SECRET', 'PUBLIC_API_URL']) {
      if (originalEnvironment[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnvironment[key];
      }
    }
    app = module.createNestApplication({ logger: false });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    await source.query('truncate users,workspaces,link_previews cascade');
    await store.client.flushDb();
    app.get(ConfigService).set('LINK_SECRET', 'x'.repeat(64));
    app.get(ConfigService).set('PUBLIC_API_URL', 'http://127.0.0.1:3001');
    app.get(ConfigService).set('PUBLIC_WEB_URL', undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await source.query('truncate users,workspaces,link_previews cascade');
    await store.client.flushDb();
    await app.close();
    storage.close();
    if (source.isInitialized) {
      await source.destroy();
    }
    for (const key of ['DATABASE_URL', 'REDIS_URL', 'LINK_SECRET', 'PUBLIC_API_URL']) {
      if (originalEnvironment[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnvironment[key];
      }
    }
  });
  const api = () => request(app.getHttpServer());
  function cookie(response: request.Response, name: string) {
    return (response.headers['set-cookie'] as unknown as string[])
      .find((v) => v.startsWith(`${name}=`))!
      .split(';')[0]!;
  }
  async function fixture() {
    const signed = await api()
      .post('/auth/signup')
      .send({
        email: `${randomUUID()}@example.com`,
        displayName: 'Planner',
        password: 'correct horse battery staple',
      })
      .expect(201);
    const accountCookie = cookie(signed, SESSION_COOKIE);
    const business = await api()
      .post('/workspaces')
      .set('Cookie', accountCookie)
      .send({ name: 'Studio' })
      .expect(201);
    const created = await api()
      .post(`/workspaces/${business.body.id}/clients`)
      .set('Cookie', accountCookie)
      .send({ name: ' Client ' })
      .expect(201);
    const client = clientResponseSchema.parse(created.body);
    const contacted = await api()
      .post(`/clients/${client.id}/contacts`)
      .set('Cookie', accountCookie)
      .send({ name: ' Ada ', email: ' ADA@EXAMPLE.COM ' })
      .expect(201);
    const contact = contactResponseSchema.parse(contacted.body);
    const boards = [];
    for (const title of ['A', 'B']) {
      const result = await api()
        .post('/boards')
        .set('Cookie', accountCookie)
        .send({ workspaceId: business.body.id, clientId: client.id, title })
        .expect(201);
      const assigned = await api()
        .post(`/boards/${result.body.id}/participants`)
        .set('Cookie', accountCookie)
        .send({ contactId: contact.id, role: 'approver' })
        .expect(201);
      const participant = contactParticipantResponseSchema.parse(assigned.body);
      const link = await api()
        .get(`/boards/${result.body.id}/participants/${participant.id}/link`)
        .set('Cookie', accountCookie)
        .expect(200);
      const url = contactLinkResponseSchema.parse(link.body).url;
      boards.push({ id: result.body.id as string, participant, path: new URL(url).pathname });
    }
    return {
      accountCookie,
      client,
      contact,
      boards,
      userId: signed.body.user.id as string,
      workspaceId: business.body.id as string,
    };
  }
  async function open(path: string, accountCookie?: string) {
    const call = api().get(path);
    if (accountCookie) {
      call.set('Cookie', accountCookie);
    }
    const response = await call.expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect((response.headers['set-cookie'] as unknown as string[])[0]).toContain('Path=/client;');
    return { contactCookie: cookie(response, CONTACT_COOKIE), response };
  }
  it('redirects browser navigation to the web entry while preserving JSON exchange', async () => {
    const f = await fixture();
    const oldPath = f.boards[0]!.path;
    app.get(ConfigService).set('PUBLIC_WEB_URL', 'http://127.0.0.1:3000');
    const newLink = await api()
      .get(`/boards/${f.boards[0]!.id}/participants/${f.boards[0]!.participant.id}/link`)
      .set('Cookie', f.accountCookie)
      .expect(200);
    expect(contactLinkResponseSchema.parse(newLink.body).url).toBe(
      `http://127.0.0.1:3000${oldPath}`,
    );
    const redirected = await api()
      .get(oldPath)
      .set('Accept', 'text/html,application/xhtml+xml,*/*;q=0.8')
      .expect(302);
    expect(redirected.headers.location).toBe(`http://127.0.0.1:3000${oldPath}`);
    expect(redirected.headers['referrer-policy']).toBe('no-referrer');
    const exchanged = await api().get(oldPath).set('Accept', 'application/json').expect(200);
    expect(shareResponseSchema.parse(exchanged.body).board.id).toBe(f.boards[0]!.id);
  });
  it('reads notes, shared previews and private images from one board with contact permissions while the planner stays signed in', async () => {
    const f = await fixture();
    const a = f.boards[0]!;
    const b = f.boards[1]!;
    const note = await api()
      .post(`/boards/${a.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'note', zOrder: 'a0', note: 'Client idea', priceCents: 4500 })
      .expect(201);
    const link = await api()
      .post(`/boards/${a.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'link', zOrder: 'b0', url: 'https://example.com/idea' })
      .expect(201);
    const processors = new MediaProcessors(source, storage, {
      fetch: async (url) => ({ url, html: '<meta property="og:title" content="Idea">' }),
    });
    await processors.preview({ entityId: link.body.preview.id, generation: 'initial' });
    const bytes = await sharp({
      create: { width: 32, height: 16, channels: 3, background: '#884422' },
    })
      .png()
      .toBuffer();
    const reservation = await api()
      .post(`/boards/${a.id}/assets/presign`)
      .set('Cookie', f.accountCookie)
      .send({ mime: 'image/png', bytes: bytes.length })
      .expect(201);
    expect(
      (
        await fetch(reservation.body.url, {
          method: 'PUT',
          headers: reservation.body.headers,
          body: new Uint8Array(bytes),
        })
      ).status,
    ).toBe(200);
    await api()
      .post(`/boards/${a.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'image', zOrder: 'c0', assetId: reservation.body.assetId })
      .expect(201);
    const opened = await open(a.path, f.accountCookie);
    expect(shareResponseSchema.parse(opened.response.body)).toMatchObject({
      board: { id: a.id },
      role: 'approver',
    });
    const mixed = `${f.accountCookie}; ${opened.contactCookie}`;
    await api()
      .get(`/client/assets/${reservation.body.assetId}/url`)
      .set('Cookie', mixed)
      .expect(409);
    await processors.image({ entityId: reservation.body.assetId, generation: 'initial' });
    const detail = await api().get('/client/board').set('Cookie', mixed).expect(200);
    expect(boardDetailResponseSchema.parse(detail.body)).toMatchObject({
      board: { id: a.id },
      role: 'approver',
    });
    const listed = await api().get('/client/board/items').set('Cookie', mixed).expect(200);
    const items = itemListResponseSchema.parse(listed.body);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ id: note.body.id, note: 'Client idea' });
    for (const item of items) {
      expect(item).not.toHaveProperty('priceCents');
    }
    expect(items[1]).toMatchObject({ kind: 'link', preview: { status: 'ready', title: 'Idea' } });
    const signedUrl = await api()
      .get(`/client/assets/${reservation.body.assetId}/url`)
      .set('Cookie', mixed)
      .expect(200);
    expect(
      Buffer.from(
        await (await fetch(assetUrlResponseSchema.parse(signedUrl.body).url)).arrayBuffer(),
      ),
    ).toEqual(bytes);
    await api()
      .get(`/client/assets/${reservation.body.assetId}/url?variant=thumbnail`)
      .set('Cookie', mixed)
      .expect(200);
    const foreign = await api()
      .post(`/boards/${b.id}/assets/presign`)
      .set('Cookie', f.accountCookie)
      .send({ mime: 'image/png', bytes: bytes.length })
      .expect(201);
    await api().get(`/client/assets/${foreign.body.assetId}/url`).set('Cookie', mixed).expect(404);
    await api().get(`/client/assets/${randomUUID()}/url`).set('Cookie', mixed).expect(404);
    await api().get(`/client/board/${b.id}`).set('Cookie', mixed).expect(404);
    await api().get('/client/boards').set('Cookie', mixed).expect(404);
    await api().get('/client/board').set('Cookie', f.accountCookie).expect(401);
    await api().get('/me').set('Cookie', opened.contactCookie).expect(401);
    await api()
      .post(`/boards/${a.id}/items`)
      .set('Cookie', opened.contactCookie)
      .send({ id: randomUUID(), kind: 'note', zOrder: 'z0' })
      .expect(401);
    await source.query("update boards set show_prices_to='approver',locked_at=now() where id=$1", [
      a.id,
    ]);
    expect((await api().get('/client/board').set('Cookie', mixed).expect(200)).body.role).toBe(
      'viewer',
    );
    expect(
      (await api().get('/client/board/items').set('Cookie', mixed).expect(200)).body[0],
    ).not.toHaveProperty('priceCents');
    await source.query('update boards set locked_at=null where id=$1', [a.id]);
    expect(
      (await api().get('/client/board/items').set('Cookie', mixed).expect(200)).body[0].priceCents,
    ).toBe(4500);
    await api().post('/client/logout').set('Cookie', mixed).send({}).expect(204);
    await api().get('/client/board').set('Cookie', mixed).expect(401);
    await api().get('/me').set('Cookie', mixed).expect(200);
  });
  it('rotates only one board link and removes all access when the contact is deleted', async () => {
    const f = await fixture();
    const a = f.boards[0]!;
    const b = f.boards[1]!;
    const openedA = await open(a.path);
    const openedB = await open(b.path);
    const rotated = await api()
      .post(`/boards/${a.id}/participants/${a.participant.id}/new-link`)
      .set('Cookie', f.accountCookie)
      .send({})
      .expect(200);
    await api().get(a.path).expect(404);
    await api().get('/client/board').set('Cookie', openedA.contactCookie).expect(401);
    await api().get('/client/board').set('Cookie', openedB.contactCookie).expect(200);
    await open(b.path);
    const reopened = await open(new URL(rotated.body.url).pathname);
    await api().delete(`/contacts/${f.contact.id}`).set('Cookie', f.accountCookie).expect(204);
    await api().delete(`/contacts/${f.contact.id}`).set('Cookie', f.accountCookie).expect(204);
    await api().get('/client/board').set('Cookie', reopened.contactCookie).expect(401);
    await api().get('/client/board').set('Cookie', openedB.contactCookie).expect(401);
    await api().get(b.path).expect(404);
    await api()
      .get(`/clients/${f.client.id}/contacts`)
      .set('Cookie', f.accountCookie)
      .expect(200, []);
    expect(
      await source.query('select name,email from client_contacts where id=$1', [f.contact.id]),
    ).toEqual([{ name: '', email: null }]);
  });
  it('rechecks contact access after awaited media signing and handles storage failures', async () => {
    const f = await fixture();
    const a = f.boards[0]!;
    const assetId = randomUUID();
    const key = `client-test/${assetId}`;
    await storage.put(key, Buffer.from('bytes'), 'image/png');
    await source.query(
      "insert into assets(id,board_id,storage_key,mime_type,bytes,status) values($1,$2,$3,'image/png',5,'ready')",
      [assetId, a.id, key],
    );
    const opened = await open(a.path);
    const signing = storage.presignGet.bind(storage);
    jest.spyOn(storage, 'presignGet').mockImplementation(async (...args) => {
      await api()
        .post(`/boards/${a.id}/participants/${a.participant.id}/new-link`)
        .set('Cookie', f.accountCookie)
        .send({})
        .expect(200);
      return signing(...args);
    });
    await api()
      .get(`/client/assets/${assetId}/url`)
      .set('Cookie', opened.contactCookie)
      .expect(401);
    jest.restoreAllMocks();
    const link = await api()
      .get(`/boards/${a.id}/participants/${a.participant.id}/link`)
      .set('Cookie', f.accountCookie)
      .expect(200);
    const fresh = await open(new URL(link.body.url).pathname);
    jest.spyOn(storage, 'head').mockRejectedValue(new Error('Offline'));
    await api().get(`/client/assets/${assetId}/url`).set('Cookie', fresh.contactCookie).expect(503);
    await api().get('/client/board/items').set('Cookie', fresh.contactCookie).expect(200);
  });
  it('rejects expired sessions, rotates the secret, and bounds new exchanges while existing sessions survive Redis outages', async () => {
    const f = await fixture();
    const a = f.boards[0]!;
    const opened = await open(a.path);
    jest.spyOn(store, 'increment').mockRejectedValue(new Error('Offline'));
    await api().get(a.path).expect(503);
    await api().get('/client/board').set('Cookie', opened.contactCookie).expect(200);
    jest.restoreAllMocks();
    app.get(ConfigService).set('LINK_SECRET', 'y'.repeat(64));
    await api().get(a.path).expect(404);
    await api().get('/client/board').set('Cookie', opened.contactCookie).expect(401);
    app.get(ConfigService).set('LINK_SECRET', 'x'.repeat(64));
    await source.query("update contact_sessions set expires_at=now()-interval '1 second'");
    await api().get('/client/board').set('Cookie', opened.contactCookie).expect(401);
    await store.client.flushDb();
    for (let i = 0; i < 30; i++) {
      await api().get('/share/invalid').expect(404);
    }
    const limited = await api().get('/share/invalid').expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
  it('enforces strict requests, private management, origin checks and missing configuration', async () => {
    const f = await fixture();
    const a = f.boards[0]!;
    await api().get(`/workspaces/${f.workspaceId}/clients`).expect(401);
    await api().get(`/boards/${a.id}/participants`).expect(401);
    await api().get(`/boards/${a.id}/participants/${a.participant.id}/link`).expect(401);
    await api()
      .get(`/workspaces/${f.workspaceId}/clients?includeArchived=wrong`)
      .set('Cookie', f.accountCookie)
      .expect(400);
    await api()
      .post(`/boards/${a.id}/participants`)
      .set('Cookie', f.accountCookie)
      .send({ contactId: f.contact.id, role: 'editor' })
      .expect(400);
    await api()
      .patch(`/boards/${a.id}/participants/${a.participant.id}`)
      .set('Cookie', f.accountCookie)
      .send({})
      .expect(400);
    await api()
      .post(`/boards/${a.id}/participants/${a.participant.id}/new-link`)
      .set('Cookie', f.accountCookie)
      .send({ role: 'viewer' })
      .expect(400);
    await api().get(a.path).set('Origin', 'https://evil.example').expect(403);
    const fresh = await open(a.path);
    await api()
      .post('/client/logout')
      .set('Cookie', fresh.contactCookie)
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    await api()
      .get(`/client/assets/${randomUUID()}/url?variant=raw`)
      .set('Cookie', fresh.contactCookie)
      .expect(400);
    await api().get(`/contacts/${f.contact.id}/link`).set('Cookie', f.accountCookie).expect(404);
    app.get(ConfigService).set('PUBLIC_API_URL', '');
    await api()
      .get(`/boards/${a.id}/participants/${a.participant.id}/link`)
      .set('Cookie', f.accountCookie)
      .expect(503);
    await api().get(a.path).expect(503);
    app.get(ConfigService).set('LINK_SECRET', '');
    await api().get('/client/board').set('Cookie', fresh.contactCookie).expect(401);
  });
  it('requires all client approvers, exposes private feedback, and freezes signed-off item versions', async () => {
    const f = await fixture();
    const board = f.boards[0]!;
    const item = await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'note', zOrder: 'a', note: 'First version' })
      .expect(201);
    const otherContact = await api()
      .post(`/clients/${f.client.id}/contacts`)
      .set('Cookie', f.accountCookie)
      .send({ name: 'Second reviewer' })
      .expect(201);
    const otherAssignment = await api()
      .post(`/boards/${board.id}/participants`)
      .set('Cookie', f.accountCookie)
      .send({ contactId: otherContact.body.id, role: 'approver' })
      .expect(201);
    const otherLink = await api()
      .get(`/boards/${board.id}/participants/${otherAssignment.body.id}/link`)
      .set('Cookie', f.accountCookie)
      .expect(200);
    const first = await open(board.path);
    const second = await open(new URL(otherLink.body.url).pathname);
    const mixed = `${first.contactCookie}; ${f.accountCookie}`;
    const initially = clientApprovalListSchema.parse(
      (await api().get('/client/board/approvals').set('Cookie', mixed).expect(200)).body,
    );
    expect(initially).toEqual([
      {
        itemId: item.body.id,
        itemVersion: 1,
        status: 'pending',
        coreState: 'pending',
        ownDecision: null,
      },
    ]);
    await api().get('/client/board/approvals').set('Cookie', f.accountCookie).expect(401);
    await api().get(`/boards/${board.id}/approvals`).set('Cookie', first.contactCookie).expect(401);
    const firstId = randomUUID();
    const request = { id: firstId, itemId: item.body.id, itemVersion: 1, status: 'approved' };
    const firstDecision = decisionResponseSchema.parse(
      (
        await api()
          .post('/client/board/approvals/decisions')
          .set('Cookie', mixed)
          .send(request)
          .expect(201)
      ).body,
    );
    expect(firstDecision.approval.coreState).toBe('pending');
    const countBeforeRetry = await source.query(
      'select count(*)::int as count from board_events where board_id=$1',
      [board.id],
    );
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', mixed)
      .send(request)
      .expect(200, firstDecision);
    expect(
      await source.query('select count(*)::int as count from board_events where board_id=$1', [
        board.id,
      ]),
    ).toEqual(countBeforeRetry);
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', mixed)
      .send({ ...request, status: 'rejected' })
      .expect(409);
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', second.contactCookie)
      .send({ id: randomUUID(), itemId: item.body.id, itemVersion: 1, status: 'swap_requested' })
      .expect(400);
    const swap = await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', second.contactCookie)
      .send({
        id: randomUUID(),
        itemId: item.body.id,
        itemVersion: 1,
        status: 'swap_requested',
        comment: 'Use a lighter colour',
      })
      .expect(201);
    expect(swap.body.approval).toMatchObject({ status: 'swap_requested', coreState: 'rejected' });
    expect(
      clientApprovalListSchema.parse(
        (await api().get('/client/board/approvals').set('Cookie', mixed).expect(200)).body,
      )[0]!.ownDecision?.comment,
    ).toBeNull();
    const planner = plannerApprovalListSchema.parse(
      (await api().get(`/boards/${board.id}/approvals`).set('Cookie', f.accountCookie).expect(200))
        .body,
    );
    expect(planner[0]!.decisions.map((d) => d.comment)).toContain('Use a lighter colour');
    const completed = await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', second.contactCookie)
      .send({ id: randomUUID(), itemId: item.body.id, itemVersion: 1, status: 'approved' })
      .expect(201);
    expect(completed.body.approval.coreState).toBe('approved');
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', mixed)
      .send({ id: randomUUID(), itemId: item.body.id, itemVersion: 1, status: 'rejected' })
      .expect(409);
    const third = await api()
      .post(`/clients/${f.client.id}/contacts`)
      .set('Cookie', f.accountCookie)
      .send({ name: 'New reviewer' })
      .expect(201);
    await api()
      .post(`/boards/${board.id}/participants`)
      .set('Cookie', f.accountCookie)
      .send({ contactId: third.body.id, role: 'approver' })
      .expect(201);
    expect(
      (await api().get(`/boards/${board.id}/approvals`).set('Cookie', f.accountCookie).expect(200))
        .body[0].coreState,
    ).toBe('approved');
    await api()
      .patch(`/items/${item.body.id}/position`)
      .set('Cookie', f.accountCookie)
      .send({ x: 10 })
      .expect(200);
    expect(
      (await api().get(`/boards/${board.id}/approvals`).set('Cookie', f.accountCookie).expect(200))
        .body[0].coreState,
    ).toBe('approved');
    await api()
      .patch(`/items/${item.body.id}`)
      .set('Cookie', f.accountCookie)
      .send({ version: 1, note: 'Second version' })
      .expect(200);
    const reset = (
      await api().get(`/boards/${board.id}/approvals`).set('Cookie', f.accountCookie).expect(200)
    ).body[0];
    expect(reset).toMatchObject({ itemVersion: 2, status: 'pending', decisions: [] });
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', mixed)
      .send({ id: randomUUID(), itemId: item.body.id, itemVersion: 1, status: 'approved' })
      .expect(409);
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', mixed)
      .send(request)
      .expect(200, firstDecision);
  });
  it('reconciles expiry and rejects viewer, locked-board, and cross-board decisions', async () => {
    const f = await fixture();
    const board = f.boards[0]!;
    const item = await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'note', zOrder: 'a' })
      .expect(201);
    const opened = await open(board.path);
    const input = { id: randomUUID(), itemId: item.body.id, itemVersion: 1, status: 'approved' };
    const otherItem = await api()
      .post(`/boards/${f.boards[1]!.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'note', zOrder: 'a' })
      .expect(201);
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', opened.contactCookie)
      .send({ ...input, itemId: otherItem.body.id })
      .expect(404);
    await api()
      .patch(`/boards/${board.id}/participants/${board.participant.id}`)
      .set('Cookie', f.accountCookie)
      .send({ role: 'viewer' })
      .expect(200);
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', opened.contactCookie)
      .send(input)
      .expect(403);
    await api()
      .patch(`/boards/${board.id}/participants/${board.participant.id}`)
      .set('Cookie', f.accountCookie)
      .send({ role: 'approver' })
      .expect(200);
    await source.query('update boards set locked_at=now() where id=$1', [board.id]);
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', opened.contactCookie)
      .send(input)
      .expect(403);
    await source.query('update boards set locked_at=null where id=$1', [board.id]);
    await source.query('update boards set archived_at=now() where id=$1', [board.id]);
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', opened.contactCookie)
      .send(input)
      .expect(403);
    await source.query('update boards set archived_at=null where id=$1', [board.id]);
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', opened.contactCookie)
      .send(input)
      .expect(201);
    await source.query(
      "update board_participants set expires_at=now()-interval '1 second' where id=$1",
      [board.participant.id],
    );
    await api().get('/client/board/approvals').set('Cookie', opened.contactCookie).expect(401);
  });
  it('keeps approvals unavailable on personal and unassociated business boards', async () => {
    const f = await fixture();
    const unassociated = await api()
      .post('/boards')
      .set('Cookie', f.accountCookie)
      .send({ workspaceId: f.workspaceId, title: 'Draft' })
      .expect(201);
    await api()
      .get(`/boards/${unassociated.body.id}/approvals`)
      .set('Cookie', f.accountCookie)
      .expect(404);
    const workspaces = (await api().get('/workspaces').set('Cookie', f.accountCookie).expect(200))
      .body as { id: string; type: string }[];
    const personalId = workspaces.find((w) => w.type === 'personal')!.id;
    const personal = await api()
      .post('/boards')
      .set('Cookie', f.accountCookie)
      .send({ workspaceId: personalId, title: 'Personal' })
      .expect(201);
    await api()
      .get(`/boards/${personal.body.id}/approvals`)
      .set('Cookie', f.accountCookie)
      .expect(404);
  });
  it('reconciles pending approvals when another approver expires and serializes concurrent decisions', async () => {
    const f = await fixture();
    const board = f.boards[0]!;
    const otherContact = await api()
      .post(`/clients/${f.client.id}/contacts`)
      .set('Cookie', f.accountCookie)
      .send({ name: 'Second reviewer' })
      .expect(201);
    const otherAssignment = await api()
      .post(`/boards/${board.id}/participants`)
      .set('Cookie', f.accountCookie)
      .send({ contactId: otherContact.body.id, role: 'approver' })
      .expect(201);
    const otherLink = await api()
      .get(`/boards/${board.id}/participants/${otherAssignment.body.id}/link`)
      .set('Cookie', f.accountCookie)
      .expect(200);
    const a = await open(board.path);
    const b = await open(new URL(otherLink.body.url).pathname);
    const firstItem = await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'note', zOrder: 'a' })
      .expect(201);
    const makeDecision = (cookie: string, itemId: string) =>
      api()
        .post('/client/board/approvals/decisions')
        .set('Cookie', cookie)
        .send({ id: randomUUID(), itemId, itemVersion: 1, status: 'approved' });
    const concurrent = await Promise.all([
      makeDecision(a.contactCookie, firstItem.body.id),
      makeDecision(b.contactCookie, firstItem.body.id),
    ]);
    expect(concurrent.map((r) => r.status)).toEqual([201, 201]);
    expect(
      (await api().get(`/boards/${board.id}/approvals`).set('Cookie', f.accountCookie).expect(200))
        .body[0].coreState,
    ).toBe('approved');
    const secondItem = await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'note', zOrder: 'b' })
      .expect(201);
    await makeDecision(a.contactCookie, secondItem.body.id).expect(201);
    expect(
      (await api().get(`/boards/${board.id}/approvals`).set('Cookie', f.accountCookie).expect(200))
        .body[1].coreState,
    ).toBe('pending');
    await source.query(
      "update board_participants set expires_at=now()-interval '1 second' where id=$1",
      [otherAssignment.body.id],
    );
    expect(
      (await api().get(`/boards/${board.id}/approvals`).set('Cookie', f.accountCookie).expect(200))
        .body[1].coreState,
    ).toBe('approved');
  });
  it('rolls back a decision and state change when its event cannot be written', async () => {
    const f = await fixture();
    const board = f.boards[0]!;
    const item = await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', f.accountCookie)
      .send({ id: randomUUID(), kind: 'note', zOrder: 'a' })
      .expect(201);
    const opened = await open(board.path);
    const id = randomUUID();
    const events = app.get(BoardEventWriter);
    const append = events.append.bind(events);
    jest.spyOn(events, 'append').mockImplementation((manager, boardId, actorId, event) => {
      if (event.type === 'item.decided') {
        throw new Error('Event unavailable');
      }
      return append(manager, boardId, actorId, event);
    });
    await api()
      .post('/client/board/approvals/decisions')
      .set('Cookie', opened.contactCookie)
      .send({ id, itemId: item.body.id, itemVersion: 1, status: 'approved' })
      .expect(500);
    jest.restoreAllMocks();
    expect(await source.query('select id from approval_decisions where id=$1', [id])).toEqual([]);
    expect(
      await source.query('select item_id from approval_states where item_id=$1', [item.body.id]),
    ).toEqual([]);
  });
});
