import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { itemResponseSchema } from '@moodboard/contracts';
import { R2Storage } from '@moodboard/storage';
import { AssetsRepository } from '../apps/api/src/features/assets/assets.repository';
import { AssetsService } from '../apps/api/src/features/assets/assets.service';
import { MediaStorage } from '../apps/api/src/platform/storage/storage.module';
import { ItemsService } from '../apps/api/src/features/items/items.service';
import { ItemsRepository } from '../apps/api/src/features/items/items.repository';
import { ItemPreviewsRepository } from '../apps/api/src/features/items/item-previews.repository';
import { MediaProcessors } from '../apps/worker/src/jobs/processors';
import { InvalidMedia } from '../apps/worker/src/jobs/egress';
import { Maintenance } from '../apps/worker/src/jobs/maintenance';
import { MediaQueues } from '../apps/worker/src/queues/media';
import { testDataSource } from './database';
import { boardServices, boardWorkspace, boardUser } from './board-fixture';
import { testStorage } from './storage';
import { testRedisUrl } from './redis';
describe('Media storage and transactional results', () => {
  const source = testDataSource(8);
  const services = boardServices(source);
  let storage: R2Storage;
  let assets: AssetsService;
  let items: ItemsService;
  let processors: MediaProcessors;
  const fetcher = { fetch: jest.fn() };
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    storage = await testStorage();
    const media = {
      storage,
      maxBytes: 10485760,
      require: () => storage,
      onModuleDestroy: () => undefined,
    } as MediaStorage;
    assets = new AssetsService(new AssetsRepository(source), services.access, media);
    items = new ItemsService(
      services.access,
      new ItemsRepository(source),
      services.sectionsRepository,
      services.events,
      new ItemPreviewsRepository(),
      assets,
    );
    processors = new MediaProcessors(source, storage, fetcher);
  });
  beforeEach(async () => {
    await source.query('truncate users,workspaces,link_previews cascade');
    fetcher.fetch.mockReset();
  });
  afterAll(async () => {
    storage?.close();
    if (source.isInitialized) {
      await source.query('truncate users,workspaces,link_previews cascade');
      await source.destroy();
    }
  });
  async function board() {
    const owner = await boardWorkspace(source);
    return {
      ...owner,
      board: await services.boards.create(owner.userId, {
        workspaceId: owner.workspaceId,
        title: 'Media',
      }),
    };
  }
  async function image() {
    const owner = await board();
    const body = await sharp({
      create: { width: 800, height: 400, channels: 3, background: '#e05030' },
    })
      .png()
      .toBuffer();
    const upload = await assets.presign(owner.userId, owner.board.id, {
      mime: 'image/png',
      bytes: body.length,
    });
    const response = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: new Uint8Array(body),
    });
    expect(response.status).toBe(200);
    const result = await items.create(owner.userId, owner.board.id, {
      id: randomUUID(),
      kind: 'image',
      assetId: upload.assetId,
      zOrder: 'a0',
      priceCents: 500,
    });
    return { ...owner, body, upload, item: result.item };
  }
  it('lists mixed media in a bounded number of queries while preserving metadata and price filtering', async () => {
    const owner = await image();
    await processors.image({ entityId: owner.upload.assetId, generation: 'initial' });
    const expected = [];
    for (let index = 0; index < 18; index++) {
      const base = {
        id: randomUUID(),
        zOrder: `b${index.toString().padStart(2, '0')}`,
        priceCents: 500,
      };
      const result = await items.create(
        owner.userId,
        owner.board.id,
        index % 3 === 0
          ? { ...base, kind: 'note', note: 'Note' }
          : index % 3 === 1
            ? { ...base, kind: 'image', assetId: owner.upload.assetId }
            : { ...base, kind: 'link', url: `https://example.com/list/${index % 2}` },
      );
      expected.push(result.item);
    }
    const viewer = await boardUser(source);
    await source.query(
      "insert into board_participants (id,board_id,user_id,role) values ($1,$2,$3,'viewer')",
      [randomUUID(), owner.board.id, viewer],
    );
    const queries = jest.spyOn(source.logger, 'logQuery');
    let listed;
    try {
      listed = await items.list(viewer, owner.board.id);
      expect(queries.mock.calls.length).toBeLessThan(10);
    } finally {
      queries.mockRestore();
    }
    expect(listed).toHaveLength(19);
    expect(listed.slice(1).map((item) => item.id)).toEqual(expected.map((item) => item.id));
    for (const item of listed) {
      expect(itemResponseSchema.parse(item)).not.toHaveProperty('priceCents');
      expect(JSON.stringify(item)).not.toMatch(/storage_key|thumbnail_key|board_id/);
      if (item.kind === 'image') {
        expect(item.asset).toMatchObject({
          id: owner.upload.assetId,
          status: 'ready',
          width: 800,
          height: 400,
        });
      } else if (item.kind === 'link') {
        const original = expected.find((entry) => entry.id === item.id);
        if (original?.kind !== 'link') {
          throw new Error('Expected link');
        }
        expect(item.preview).toEqual(original.preview);
      }
    }
  });
  it('enforces signed MIME and exact size, rejects missing objects, and keeps staging private', async () => {
    const owner = await board();
    const upload = await assets.presign(owner.userId, owner.board.id, {
      mime: 'image/png',
      bytes: 3,
    });
    expect(new URL(upload.url).searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    expect(
      (
        await fetch(upload.url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: new Uint8Array([1, 2, 3]),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(upload.url, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: new Uint8Array([1, 2, 3, 4]),
        })
      ).status,
    ).toBe(403);
    await expect(
      items.create(owner.userId, owner.board.id, {
        id: randomUUID(),
        kind: 'image',
        assetId: upload.assetId,
        zOrder: 'a0',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(assets.url(owner.userId, upload.assetId, 'original')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      assets.presign(owner.userId, owner.board.id, { mime: 'image/png', bytes: 10485761 }),
    ).rejects.toThrow('Upload exceeds');
  });
  it('promotes validated images exactly once, generates thumbnails and palette, and survives staging overwrite', async () => {
    const { userId, board, body, upload, item } = await image();
    expect(itemResponseSchema.parse(item).kind).toBe('image');
    expect(JSON.stringify(item)).not.toMatch(/storage_key|staging\/|X-Amz/);
    const job = { entityId: upload.assetId, generation: 'initial' };
    await Promise.all([processors.image(job), processors.image(job)]);
    const [asset] = await source.query('select * from assets where id=$1', [upload.assetId]);
    expect(asset).toMatchObject({ status: 'ready', width: 800, height: 400 });
    expect(asset.palette).toHaveLength(5);
    expect(
      await source.query("select count(*)::int as n from board_events where type='asset.ready'"),
    ).toEqual([{ n: 1 }]);
    const thumb = await storage.read(asset.thumbnail_key, 10485760);
    expect(await sharp(thumb).metadata()).toMatchObject({
      width: 512,
      height: 256,
      format: 'webp',
    });
    const replacement = Buffer.alloc(body.length, 0);
    expect(
      (
        await fetch(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body: new Uint8Array(replacement),
        })
      ).status,
    ).toBe(200);
    const signed = await assets.url(userId, upload.assetId, 'original');
    expect(Buffer.from(await (await fetch(signed.url)).arrayBuffer())).toEqual(body);
    await processors.image(job);
    expect(
      await source.query("select count(*)::int as n from board_events where type='asset.ready'"),
    ).toEqual([{ n: 1 }]);
    await items.delete(userId, item.id);
    const retry = await items.create(userId, board.id, {
      id: item.id,
      kind: 'image',
      assetId: randomUUID(),
      zOrder: 'z9',
    });
    expect(retry.created).toBe(false);
    expect(retry.item.deletedAt).not.toBeNull();
  });
  it('refuses expired PUT signatures', async () => {
    let signed;
    jest.useFakeTimers({ now: Date.now() - 3600_000 });
    try {
      signed = await storage.presignPut(`expired/${randomUUID()}`, 'image/png', 3);
    } finally {
      jest.useRealTimers();
    }
    expect(
      (
        await fetch(signed.url, {
          method: 'PUT',
          headers: signed.headers,
          body: new Uint8Array([1, 2, 3]),
        })
      ).status,
    ).toBe(403);
  });
  it('rechecks access after awaiting storage before returning a signed read URL', async () => {
    const { userId, board, upload } = await image();
    await processors.image({ entityId: upload.assetId, generation: 'initial' });
    const original = storage.presignGet.bind(storage);
    const spy = jest.spyOn(storage, 'presignGet').mockImplementation(async (key, mime) => {
      const signed = await original(key, mime);
      await source.query(
        'update board_participants set revoked_at=now() where board_id=$1 and user_id=$2',
        [board.id, userId],
      );
      return signed;
    });
    try {
      await expect(assets.url(userId, upload.assetId, 'original')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('rolls back a failed completion and safely retries with fresh output keys', async () => {
    const { upload } = await image();
    await source.query(
      "create function media_completion_failure() returns trigger language plpgsql as $$ begin if new.type='asset.ready' then raise exception 'forced failure'; end if; return new; end $$",
    );
    await source.query(
      'create trigger media_completion_failure before insert on board_events for each row execute function media_completion_failure()',
    );
    try {
      await expect(
        processors.image({ entityId: upload.assetId, generation: 'initial' }),
      ).rejects.toThrow('forced failure');
      expect(await source.query('select status from assets where id=$1', [upload.assetId])).toEqual(
        [{ status: 'pending' }],
      );
    } finally {
      await source.query('drop trigger media_completion_failure on board_events');
      await source.query('drop function media_completion_failure()');
    }
    await processors.image({ entityId: upload.assetId, generation: 'initial' });
    expect(await source.query('select status from assets where id=$1', [upload.assetId])).toEqual([
      { status: 'ready' },
    ]);
  });
  it('rejects corrupt and animated input and persists one terminal failure event', async () => {
    const { upload } = await image();
    const [asset] = await source.query('select * from assets where id=$1', [upload.assetId]);
    await storage.put(asset.storage_key, Buffer.alloc(asset.bytes, 0), 'image/png');
    await expect(
      processors.image({ entityId: upload.assetId, generation: 'initial' }),
    ).rejects.toBeInstanceOf(InvalidMedia);
    await processors.fail('process-image', { entityId: upload.assetId, generation: 'initial' });
    await processors.fail('process-image', { entityId: upload.assetId, generation: 'initial' });
    expect(
      await source.query("select count(*)::int as n from board_events where type='asset.failed'"),
    ).toEqual([{ n: 1 }]);
  });
  it('rejects animated WebP and excessive decoded pixel dimensions', async () => {
    const owner = await board();
    const animated = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]), {
      raw: { width: 2, height: 2, channels: 3, pageHeight: 1 },
    })
      .webp()
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    const oversized = await sharp({
      create: { width: 7000, height: 6000, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    for (const [body, mime] of [
      [animated, 'image/webp'],
      [oversized, 'image/png'],
    ] as const) {
      const upload = await assets.presign(owner.userId, owner.board.id, {
        mime,
        bytes: body.length,
      });
      expect(
        (
          await fetch(upload.url, {
            method: 'PUT',
            headers: upload.headers,
            body: new Uint8Array(body),
          })
        ).status,
      ).toBe(200);
      await items.create(owner.userId, owner.board.id, {
        id: randomUUID(),
        kind: 'image',
        assetId: upload.assetId,
        zOrder: 'a0',
      });
      await expect(
        processors.image({ entityId: upload.assetId, generation: 'initial' }),
      ).rejects.toBeInstanceOf(InvalidMedia);
    }
    expect(await source.query("select id from board_events where type='asset.ready'")).toEqual([]);
  });
  it('isolates assets by board and role, and filters media prices in all responses', async () => {
    const imageOwner = await image();
    const other = await board();
    const stranger = await boardUser(source);
    await expect(
      assets.url(stranger, imageOwner.upload.assetId, 'original'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      items.create(other.userId, other.board.id, {
        id: randomUUID(),
        kind: 'image',
        assetId: imageOwner.upload.assetId,
        zOrder: 'a0',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await source.query(
      "insert into board_participants (id,board_id,user_id,role) values ($1,$2,$3,'viewer')",
      [randomUUID(), imageOwner.board.id, stranger],
    );
    const list = await items.list(stranger, imageOwner.board.id);
    expect(list[0]).not.toHaveProperty('priceCents');
  });
  it('shares previews, emits one result per live board, preserves metadata on failed refresh, and ignores stale jobs', async () => {
    const first = await board();
    const second = await board();
    const url = 'https://example.com/product?q=1';
    const create = (owner: typeof first) =>
      items.create(owner.userId, owner.board.id, {
        id: randomUUID(),
        kind: 'link',
        url,
        zOrder: 'a0',
      });
    const [one, two] = await Promise.all([create(first), create(second)]);
    if (one.item.kind !== 'link' || two.item.kind !== 'link') {
      throw new Error('Expected links');
    }
    expect(one.item.preview.id).toBe(two.item.preview.id);
    const id = one.item.preview.id;
    fetcher.fetch.mockResolvedValue({ url, html: '<meta property="og:title" content="Lamp">' });
    await Promise.all([
      processors.preview({ entityId: id, generation: 'initial' }),
      processors.preview({ entityId: id, generation: 'initial' }),
    ]);
    expect(
      await source.query("select count(*)::int as n from board_events where type='preview.ready'"),
    ).toEqual([{ n: 2 }]);
    await source.query("update link_previews set expires_at=now()-interval '1 day' where id=$1", [
      id,
    ]);
    const [row] = await source.query('select expires_at from link_previews where id=$1', [id]);
    await processors.fail('fetch-preview', {
      entityId: id,
      generation: row.expires_at.toISOString(),
    });
    expect(await source.query('select status,title from link_previews where id=$1', [id])).toEqual([
      { status: 'failed', title: 'Lamp' },
    ]);
    await processors.preview({ entityId: id, generation: 'initial' });
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });
  async function waitForLock(
    runner: ReturnType<typeof source.createQueryRunner>,
    transitive = false,
  ) {
    const [{ pid }] = await runner.query('select pg_backend_pid() as pid');
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await source.query(
        `select exists (
          select 1 from pg_stat_activity a where a.datname=current_database() and a.wait_event_type='Lock'
          and case when $2 then exists (
            select 1 from pg_stat_activity b where $1=any(pg_blocking_pids(b.pid)) and b.pid=any(pg_blocking_pids(a.pid))
          ) else $1=any(pg_blocking_pids(a.pid)) end
        ) as blocked`,
        [pid, transitive],
      );
      if (row.blocked) {
        return;
      }
      await delay(10);
    }
    throw new Error('Expected concurrent transaction to wait for its lock');
  }
  it('rechecks live references when deletion commits while completion waits for a board lock', async () => {
    const owner = await board();
    const { item } = await items.create(owner.userId, owner.board.id, {
      id: randomUUID(),
      kind: 'link',
      url: 'https://example.com/race',
      zOrder: 'a0',
    });
    if (item.kind !== 'link') {
      throw new Error('Expected link');
    }
    fetcher.fetch.mockResolvedValue({ url: item.preview.url, html: '<title>Ready</title>' });
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('select id from boards where id=$1 for update', [owner.board.id]);
    const completion = processors.preview({ entityId: item.preview.id, generation: 'initial' });
    try {
      await waitForLock(runner);
      await runner.query('update items set deleted_at=now() where id=$1', [item.id]);
      await runner.commitTransaction();
      await completion;
      expect(await source.query("select id from board_events where type='preview.ready'")).toEqual(
        [],
      );
      expect(
        await source.query('select status from link_previews where id=$1', [item.preview.id]),
      ).toEqual([{ status: 'ready' }]);
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
      await completion;
    }
  });
  it('serializes a second board attaching while preview completion is in progress', async () => {
    const first = await board();
    const second = await board();
    const url = 'https://example.com/attach-race';
    const { item } = await items.create(first.userId, first.board.id, {
      id: randomUUID(),
      kind: 'link',
      url,
      zOrder: 'a0',
    });
    if (item.kind !== 'link') {
      throw new Error('Expected link');
    }
    fetcher.fetch.mockResolvedValue({ url, html: '<title>Shared</title>' });
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('select id from boards where id=$1 for update', [first.board.id]);
    const completion = processors.preview({ entityId: item.preview.id, generation: 'initial' });
    let attachment: ReturnType<ItemsService['create']> | undefined;
    try {
      await waitForLock(runner);
      attachment = items.create(second.userId, second.board.id, {
        id: randomUUID(),
        kind: 'link',
        url,
        zOrder: 'a0',
      });
      await waitForLock(runner, true);
      await runner.commitTransaction();
      await completion;
      const attached = await attachment;
      expect(attached.item).toMatchObject({
        kind: 'link',
        preview: { id: item.preview.id, status: 'ready', title: 'Shared' },
      });
      expect(
        await source.query("select board_id from board_events where type='preview.ready'"),
      ).toEqual([{ board_id: first.board.id }]);
    } finally {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      await runner.release();
      await Promise.all([completion, attachment]);
    }
  });
  it('keeps orphan removal safe for attached and soft-deleted items', async () => {
    const owner = await image();
    await items.delete(owner.userId, owner.item.id);
    const orphan = await assets.presign(owner.userId, owner.board.id, {
      mime: 'image/png',
      bytes: 3,
    });
    await source.query("update assets set created_at=now()-interval '2 days'");
    const queues = new MediaQueues(testRedisUrl(), `cleanup-${randomUUID()}`);
    try {
      const maintenance = new Maintenance(source, storage, queues, processors);
      await maintenance.cleanup();
      expect(await source.query('select id from assets where id=$1', [orphan.assetId])).toEqual([]);
      expect(
        await source.query('select id from assets where id=$1', [owner.upload.assetId]),
      ).toHaveLength(1);
      await source.query(
        "update board_events set dispatched_at=now()-interval '31 days' where type='board.created'",
      );
      await maintenance.prune();
      expect(await source.query("select id from board_events where type='board.created'")).toEqual(
        [],
      );
      expect(
        await source.query("select id from board_events where type='item.created'"),
      ).toHaveLength(1);
    } finally {
      await queues.close();
    }
  });
});
