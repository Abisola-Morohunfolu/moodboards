import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  accountResponseSchema,
  boardDetailResponseSchema,
  boardListResponseSchema,
  boardWithRoleResponseSchema,
  noteConflictResponseSchema,
  noteListResponseSchema,
  noteResponseSchema,
  sectionResponseSchema,
  workspaceSearchResponseSchema,
  trashPageResponseSchema,
} from '@moodboard/contracts';
import { AppModule } from '../apps/api/src/app.module';
import { configureHttp } from '../apps/api/src/app.setup';
import { SESSION_COOKIE } from '../apps/api/src/features/auth/cookies';
import { RedisRateLimitStore } from '../apps/api/src/features/auth/redis-rate-limit.store';
import { testRateLimitStore, testRedisUrl } from './redis';
import { testDatabaseUrl, testDataSource } from './database';

describe('Board core HTTP workflow', () => {
  const source = testDataSource(8);
  const store = testRateLimitStore();
  const databaseUrl = testDatabaseUrl();
  const developmentUrl = process.env.DATABASE_URL;
  const origin = 'http://localhost:3000';
  let app: INestApplication;
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    await store.client.connect();
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot({ DATABASE_URL: databaseUrl, REDIS_URL: testRedisUrl() })],
    })
      .overrideProvider(DataSource)
      .useValue(source)
      .overrideProvider(RedisRateLimitStore)
      .useValue(store)
      .compile();
    if (developmentUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = developmentUrl;
    }
    app = module.createNestApplication({ logger: false });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    await source.query(
      'truncate users, workspaces, auth_rate_limits, google_auth_attempts cascade',
    );
    await store.client.flushDb();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await source.query(
      'truncate users, workspaces, auth_rate_limits, google_auth_attempts cascade',
    );
    await store.client.flushDb();
    await app.close();
    if (source.isInitialized) {
      await source.destroy();
    }
  });
  function api() {
    return request(app.getHttpServer());
  }
  async function signup() {
    const response = await api()
      .post('/auth/signup')
      .send({
        email: `${randomUUID()}@example.com`,
        displayName: 'Planner',
        password: 'correct horse battery staple',
      })
      .expect(201);
    const account = accountResponseSchema.parse(response.body);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const cookie = cookies.find((value) => value.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
    return { cookie, userId: account.user.id, workspaceId: account.workspaces[0]!.id };
  }
  async function createBoard(owner: { cookie: string; workspaceId: string }) {
    const response = await api()
      .post('/boards')
      .set('Cookie', owner.cookie)
      .send({ workspaceId: owner.workspaceId, title: '  Ideas  ' })
      .expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    return boardWithRoleResponseSchema.parse(response.body);
  }
  it('searches a workspace and restores trash through validated account-only HTTP routes', async () => {
    const owner = await signup();
    const board = await createBoard(owner);
    const input = { id: randomUUID(), kind: 'note', zOrder: 'a0', title: 'Find this idea' };
    const created = await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send(input)
      .expect(201);
    await api().get(`/workspaces/${owner.workspaceId}/search`).query({ q: 'idea' }).expect(401);
    const found = await api()
      .get(`/workspaces/${owner.workspaceId}/search`)
      .set('Cookie', owner.cookie)
      .query({ q: 'IDEA', kind: 'note' })
      .expect(200);
    expect(found.headers['cache-control']).toBe('no-store');
    expect(workspaceSearchResponseSchema.parse(found.body).results[0]).toMatchObject({
      type: 'item',
      item: { id: input.id },
    });
    for (const query of [
      { q: '' },
      { q: 'idea', kind: 'video' },
      { q: 'idea', boardId: 'broken' },
      { q: 'idea', cursor: 'broken' },
    ]) {
      await api()
        .get(`/workspaces/${owner.workspaceId}/search`)
        .set('Cookie', owner.cookie)
        .query(query)
        .expect(400);
    }
    const outsider = await signup();
    await api()
      .get(`/workspaces/${owner.workspaceId}/search`)
      .set('Cookie', outsider.cookie)
      .query({ q: 'idea' })
      .expect(404);
    await api().delete(`/items/${input.id}`).set('Cookie', owner.cookie).expect(204);
    await api().get(`/boards/${board.id}/items/trash`).expect(401);
    const trash = await api()
      .get(`/boards/${board.id}/items/trash`)
      .set('Cookie', owner.cookie)
      .expect(200);
    const tombstone = trashPageResponseSchema.parse(trash.body).items[0]!;
    await api()
      .post(`/items/${input.id}/restore`)
      .set('Cookie', owner.cookie)
      .send({ deletedAt: 'invalid' })
      .expect(400);
    const restored = await api()
      .post(`/items/${input.id}/restore`)
      .set('Cookie', owner.cookie)
      .send({ deletedAt: tombstone.deletedAt })
      .expect(200);
    expect(restored.body).toMatchObject({
      ...created.body,
      deletedAt: null,
      updatedAt: expect.any(String),
    });
    await api()
      .post(`/items/${input.id}/restore`)
      .set('Cookie', owner.cookie)
      .send({ deletedAt: tombstone.deletedAt })
      .expect(200);
    const empty = await api()
      .get(`/boards/${board.id}/items/trash`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(empty.body.items).toEqual([]);
  });
  it('completes signup, boards in both workspace types, sections, note edits, movement, and deletion', async () => {
    const owner = await signup();
    const personal = await createBoard(owner);
    expect(personal).toMatchObject({
      title: 'Ideas',
      role: 'owner',
      kitId: 'blank',
      eventSeq: '1',
    });
    const business = await api()
      .post('/workspaces')
      .set('Cookie', owner.cookie)
      .send({ name: 'Studio' })
      .expect(201);
    const board = await createBoard({ ...owner, workspaceId: business.body.id });
    const listed = await api().get('/boards').set('Cookie', owner.cookie).expect(200);
    expect(boardListResponseSchema.parse(listed.body).map((value) => value.id)).toEqual([
      personal.id,
      board.id,
    ]);
    const workspaceList = await api()
      .get(`/workspaces/${business.body.id}/boards`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(boardListResponseSchema.parse(workspaceList.body)).toHaveLength(1);
    const renamed = await api()
      .patch(`/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'Wedding', currency: 'NGN' })
      .expect(200);
    expect(boardWithRoleResponseSchema.parse(renamed.body)).toMatchObject({
      title: 'Wedding',
      currency: 'NGN',
      eventSeq: '2',
    });
    const sectionResult = await api()
      .post(`/boards/${board.id}/sections`)
      .set('Cookie', owner.cookie)
      .send({ name: ' Ceremony ', position: 'a0' })
      .expect(201);
    const section = sectionResponseSchema.parse(sectionResult.body);
    const sectionUpdate = await api()
      .patch(`/boards/${board.id}/sections/${section.id}`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Reception', position: 'Z0' })
      .expect(200);
    expect(sectionResponseSchema.parse(sectionUpdate.body).name).toBe('Reception');
    const input = {
      id: randomUUID(),
      kind: 'note',
      zOrder: 'a0',
      sectionId: section.id,
      note: '  preserve\nspaces  ',
      priceCents: 4500,
    };
    const created = await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send(input)
      .expect(201);
    const item = noteResponseSchema.parse(created.body);
    expect(item).toMatchObject({
      note: input.note,
      version: 1,
      x: 0,
      y: 0,
      quantity: 1,
      createdBy: expect.any(String),
    });
    const actor = await source.query('select user_id from board_participants where id=$1', [
      item.createdBy,
    ]);
    expect(actor[0].user_id).toBe(owner.userId);
    await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send({ ...input, note: 'ignored' })
      .expect(200, created.body);
    const edited = await api()
      .patch(`/items/${item.id}`)
      .set('Cookie', owner.cookie)
      .send({ version: 1, title: 'Plan', note: 'Edited', priceCents: null })
      .expect(200);
    expect(noteResponseSchema.parse(edited.body)).toMatchObject({
      version: 2,
      title: 'Plan',
      note: 'Edited',
      priceCents: null,
    });
    const moved = await api()
      .patch(`/items/${item.id}/position`)
      .set('Cookie', owner.cookie)
      .send({ x: 120, y: 240, zOrder: 'Z0' })
      .expect(200);
    expect(noteResponseSchema.parse(moved.body)).toMatchObject({
      version: 2,
      x: 120,
      y: 240,
      note: 'Edited',
    });
    const conflict = await api()
      .patch(`/items/${item.id}`)
      .set('Cookie', owner.cookie)
      .send({ version: 1, note: 'Stale' })
      .expect(409);
    expect(noteConflictResponseSchema.parse(conflict.body).currentItem).toEqual(moved.body);
    await api()
      .delete(`/boards/${board.id}/sections/${section.id}`)
      .set('Cookie', owner.cookie)
      .expect(204);
    const notes = await api()
      .get(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(noteListResponseSchema.parse(notes.body)[0]).toMatchObject({
      sectionId: null,
      version: 2,
    });
    const detail = await api().get(`/boards/${board.id}`).set('Cookie', owner.cookie).expect(200);
    expect(boardDetailResponseSchema.parse(detail.body)).toMatchObject({
      sections: [],
      modules: [],
      role: 'owner',
      board: { eventSeq: '8' },
    });
    await api().delete(`/items/${item.id}`).set('Cookie', owner.cookie).expect(204);
    await api().delete(`/items/${item.id}`).set('Cookie', owner.cookie).expect(204);
    const tombstone = await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send(input)
      .expect(200);
    expect(noteResponseSchema.parse(tombstone.body).deletedAt).not.toBeNull();
    await api().get(`/boards/${board.id}/items`).set('Cookie', owner.cookie).expect(200, []);
    await api()
      .patch(`/items/${item.id}`)
      .set('Cookie', owner.cookie)
      .send({ version: 2, note: 'revive' })
      .expect(404);
    await api()
      .patch(`/items/${item.id}/position`)
      .set('Cookie', owner.cookie)
      .send({ x: 1 })
      .expect(404);
  });
  it('keeps every new route private by default', async () => {
    const id = randomUUID();
    await api().get('/boards').expect(401);
    await api().get(`/workspaces/${id}/boards`).expect(401);
    await api().post('/boards').send({ workspaceId: id, title: 'Private' }).expect(401);
    await api().get(`/boards/${id}`).expect(401);
    await api().patch(`/boards/${id}`).send({ title: 'Private' }).expect(401);
    await api()
      .post(`/boards/${id}/sections`)
      .send({ name: 'Private', position: 'a0' })
      .expect(401);
    await api().patch(`/boards/${id}/sections/${id}`).send({ name: 'Private' }).expect(401);
    await api().delete(`/boards/${id}/sections/${id}`).expect(401);
    await api().get(`/boards/${id}/items`).expect(401);
    await api().post(`/boards/${id}/items`).send({ id, kind: 'note', zOrder: 'a0' }).expect(401);
    await api().patch(`/items/${id}`).send({ version: 1, note: 'Private' }).expect(401);
    await api().patch(`/items/${id}/position`).send({ x: 1 }).expect(401);
    await api().delete(`/items/${id}`).expect(401);
  });
  it('retries note creation through uppercase board and item UUIDs without another event', async () => {
    const owner = await signup();
    const board = await createBoard(owner);
    const path = `/boards/${board.id.toUpperCase()}/items`;
    const input = { id: randomUUID().toUpperCase(), kind: 'note', zOrder: 'a0' };
    const created = await api().post(path).set('Cookie', owner.cookie).send(input).expect(201);
    await api()
      .post(path)
      .set('Cookie', owner.cookie)
      .send({ ...input, note: 'ignored' })
      .expect(200, created.body);
    const detail = await api().get(`/boards/${board.id}`).set('Cookie', owner.cookie).expect(200);
    expect(detail.body.board.eventSeq).toBe('2');
  });
  it('returns 400 for coordinates that underflow storage without changing the board', async () => {
    const owner = await signup();
    const board = await createBoard(owner);
    const path = `/boards/${board.id}/items`;
    const input = { id: randomUUID(), kind: 'note', zOrder: 'a0' };
    for (const fields of [{ x: 1e-50 }, { y: -1e-50 }]) {
      await api()
        .post(path)
        .set('Cookie', owner.cookie)
        .send({ ...input, ...fields })
        .expect(400);
    }
    const created = await api()
      .post(path)
      .set('Cookie', owner.cookie)
      .send({ ...input, x: 1e-45, y: -1e-45 })
      .expect(201);
    expect(noteResponseSchema.parse(created.body)).toMatchObject({ x: 1e-45, y: -1e-45 });
    for (const fields of [{ x: 1e-50 }, { y: -1e-50 }]) {
      await api()
        .patch(`/items/${input.id}/position`)
        .set('Cookie', owner.cookie)
        .send(fields)
        .expect(400);
    }
    await api().get(path).set('Cookie', owner.cookie).expect(200, [created.body]);
    const detail = await api().get(`/boards/${board.id}`).set('Cookie', owner.cookie).expect(200);
    expect(detail.body.board.eventSeq).toBe('2');
  });
  it('isolates inaccessible boards and rejects foreign identifiers through HTTP', async () => {
    const owner = await signup();
    const stranger = await signup();
    const board = await createBoard(owner);
    const second = await createBoard(owner);
    const section = await api()
      .post(`/boards/${second.id}/sections`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Other', position: 'a0' })
      .expect(201);
    const note = { id: randomUUID(), kind: 'note', zOrder: 'a0' };
    await api().get(`/boards/${board.id}`).set('Cookie', stranger.cookie).expect(404);
    await api()
      .get(`/workspaces/${owner.workspaceId}/boards`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await api()
      .post('/boards')
      .set('Cookie', stranger.cookie)
      .send({ workspaceId: owner.workspaceId, title: 'Hidden' })
      .expect(404);
    await api().get('/boards').set('Cookie', stranger.cookie).expect(200, []);
    await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send({ ...note, sectionId: section.body.id })
      .expect(404);
    await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send(note)
      .expect(201);
    await api()
      .post(`/boards/${second.id}/items`)
      .set('Cookie', owner.cookie)
      .send(note)
      .expect(409);
    await api()
      .patch(`/items/${note.id}/position`)
      .set('Cookie', owner.cookie)
      .send({ sectionId: section.body.id })
      .expect(404);
    await api().delete(`/items/${note.id}`).set('Cookie', stranger.cookie).expect(404);
  });
  it('returns 403 for insufficient roles and filters prices at the configured threshold', async () => {
    const owner = await signup();
    const reader = await signup();
    const board = await createBoard(owner);
    const item = { id: randomUUID(), kind: 'note', zOrder: 'a0', priceCents: 1200 };
    await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send(item)
      .expect(201);
    await source.query(
      "insert into board_participants (id, board_id, user_id, role) values ($1,$2,$3,'viewer')",
      [randomUUID(), board.id, reader.userId],
    );
    const listed = await api()
      .get(`/boards/${board.id}/items`)
      .set('Cookie', reader.cookie)
      .expect(200);
    expect(noteListResponseSchema.parse(listed.body)[0]).not.toHaveProperty('priceCents');
    await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', reader.cookie)
      .send(item)
      .expect(403);
    await api()
      .patch(`/items/${item.id}`)
      .set('Cookie', reader.cookie)
      .send({ version: 1, note: 'Denied' })
      .expect(403);
    await api()
      .patch(`/boards/${board.id}`)
      .set('Cookie', reader.cookie)
      .send({ title: 'Denied' })
      .expect(403);
    await source.query("update boards set show_prices_to='viewer' where id=$1", [board.id]);
    const visible = await api()
      .get(`/boards/${board.id}/items`)
      .set('Cookie', reader.cookie)
      .expect(200);
    expect(noteListResponseSchema.parse(visible.body)[0]).toHaveProperty('priceCents', 1200);
    await source.query(
      'update board_participants set revoked_at=now() where user_id=$1 and board_id=$2',
      [reader.userId, board.id],
    );
    await api().get(`/boards/${board.id}`).set('Cookie', reader.cookie).expect(404);
    await api().get('/boards').set('Cookie', reader.cookie).expect(200, []);
  });
  it('validates paths, strict bodies, patch content, and finite storage-compatible values', async () => {
    const owner = await signup();
    const board = await createBoard(owner);
    const note = { id: randomUUID(), kind: 'note', zOrder: 'a0' };
    await api().get('/boards/not-a-uuid').set('Cookie', owner.cookie).expect(400);
    await api()
      .post('/boards')
      .set('Cookie', owner.cookie)
      .send({ workspaceId: 'bad', title: 'Name' })
      .expect(400);
    await api()
      .post('/boards')
      .set('Cookie', owner.cookie)
      .send({ workspaceId: owner.workspaceId, title: 'Name', kitId: 'events' })
      .expect(400);
    await api()
      .patch(`/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ layout: 'grid' })
      .expect(400);
    await api().patch(`/boards/${board.id}`).set('Cookie', owner.cookie).send({}).expect(400);
    await api()
      .post(`/boards/${board.id}/sections`)
      .set('Cookie', owner.cookie)
      .send({ name: ' ', position: 'a0' })
      .expect(400);
    for (const fields of [
      { kind: 'image' },
      { createdBy: owner.userId },
      { x: 1e39 },
      { quantity: 0 },
      { priceCents: 1.5 },
      { zOrder: 'a 0' },
    ]) {
      await api()
        .post(`/boards/${board.id}/items`)
        .set('Cookie', owner.cookie)
        .send({ ...note, ...fields })
        .expect(400);
    }
    await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send(note)
      .expect(201);
    await api()
      .patch(`/items/${note.id}`)
      .set('Cookie', owner.cookie)
      .send({ note: 'No version' })
      .expect(400);
    await api()
      .patch(`/items/${note.id}`)
      .set('Cookie', owner.cookie)
      .send({ version: 1 })
      .expect(400);
    await api()
      .patch(`/items/${note.id}/position`)
      .set('Cookie', owner.cookie)
      .send({ x: 5, version: 1 })
      .expect(400);
  });
  it('supports credentialed PATCH/DELETE preflights and rejects invalid origins and form bodies', async () => {
    const owner = await signup();
    const board = await createBoard(owner);
    for (const method of ['PATCH', 'DELETE']) {
      const response = await api()
        .options(`/boards/${board.id}`)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', method)
        .set('Access-Control-Request-Headers', 'Content-Type')
        .expect(204);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers['access-control-allow-methods']).toContain(method);
    }
    await api()
      .patch(`/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ title: 'Allowed' })
      .expect(200);
    await api()
      .patch(`/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .set('Origin', 'https://evil.example')
      .send({ title: 'Denied' })
      .expect(403);
    await api()
      .patch(`/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .type('form')
      .send({ title: 'Denied' })
      .expect(400);
    const item = { id: randomUUID(), kind: 'note', zOrder: 'a0' };
    await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send(item)
      .expect(201);
    await api()
      .delete(`/items/${item.id}`)
      .set('Cookie', owner.cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await api()
      .delete(`/items/${item.id}`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .expect(204);
  });
  it('keeps the existing-session board workflow working while authentication Redis is unavailable', async () => {
    const owner = await signup();
    const increment = jest
      .spyOn(store, 'increment')
      .mockRejectedValue(new Error('Redis unavailable'));
    const board = await createBoard(owner);
    const item = { id: randomUUID(), kind: 'note', zOrder: 'a0' };
    await api()
      .post(`/boards/${board.id}/items`)
      .set('Cookie', owner.cookie)
      .send(item)
      .expect(201);
    await api()
      .patch(`/items/${item.id}`)
      .set('Cookie', owner.cookie)
      .send({ version: 1, note: 'Saved' })
      .expect(200);
    await api().get(`/boards/${board.id}/items`).set('Cookie', owner.cookie).expect(200);
    await api().delete(`/items/${item.id}`).set('Cookie', owner.cookie).expect(204);
    expect(increment).not.toHaveBeenCalled();
    await api()
      .post('/auth/login')
      .send({ email: 'planner@example.com', password: 'test' })
      .expect(503);
  });
});
