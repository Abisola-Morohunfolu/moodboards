import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  itemResponseSchema,
  itemListResponseSchema,
  presignResponseSchema,
  assetUrlResponseSchema,
} from '@moodboard/contracts';
import { R2Storage } from '@moodboard/storage';
import { AppModule } from '../apps/api/src/app.module';
import { configureHttp } from '../apps/api/src/app.setup';
import { MediaProcessors } from '../apps/worker/src/jobs/processors';
import { MediaQueues } from '../apps/worker/src/queues/media';
import { WorkerRuntime } from '../apps/worker/src/runtime';
import { testDataSource, testDatabaseUrl } from './database';
import { testRateLimitStore, testRedisUrl } from './redis';
import { testStorage } from './storage';
import { RedisRateLimitStore } from '../apps/api/src/features/auth/redis-rate-limit.store';
import { MediaStorage } from '../apps/api/src/platform/storage/storage.module';
describe('Media HTTP and real worker smoke test', () => {
  const source = testDataSource(10);
  const store = testRateLimitStore();
  const originalEnvironment = { ...process.env };
  let app: INestApplication;
  let storage: R2Storage;
  let runtime: WorkerRuntime | undefined;
  let cookie: string;
  let boardId: string;
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    storage = await testStorage();
    await source.query('truncate users,workspaces,link_previews cascade');
    await store.client.connect();
    await store.client.flushDb();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          DATABASE_URL: testDatabaseUrl(),
          REDIS_URL: testRedisUrl(),
        }),
      ],
    })
      .overrideProvider(MediaStorage)
      .useValue({
        storage,
        maxBytes: storage.config.MEDIA_UPLOAD_MAX_BYTES,
        require: () => storage,
      })
      .overrideProvider(RedisRateLimitStore)
      .useValue(store)
      .compile();
    for (const key of [
      'DATABASE_URL',
      'REDIS_URL',
      'R2_ACCOUNT_ID',
      'R2_BUCKET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ]) {
      if (originalEnvironment[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnvironment[key];
      }
    }
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        email: `${randomUUID()}@example.com`,
        password: 'correct horse battery staple',
        displayName: 'Media tester',
      })
      .expect(201);
    cookie = (signup.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const workspaceId = signup.body.workspaces[0].id;
    const board = await request(app.getHttpServer())
      .post('/boards')
      .set('Cookie', cookie)
      .send({ workspaceId, title: 'Media smoke' })
      .expect(201);
    boardId = board.body.id;
  });
  afterAll(async () => {
    if (runtime) {
      await runtime.close();
      const cleanup = new MediaQueues(testRedisUrl(), runtime.queues.prefix);
      try {
        for (const queue of Object.values(cleanup.queues)) {
          await queue.waitUntilReady();
          await queue.obliterate({ force: true });
        }
      } finally {
        await cleanup.close();
      }
    }
    if (store.client.isOpen) {
      await store.client.flushDb();
    }
    await app?.close();
    storage?.close();
    if (source.isInitialized) {
      await source.query('truncate users,workspaces,link_previews cascade');
      await source.destroy();
    }
  });
  async function waitReady(id: string) {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
      const response = await request(app.getHttpServer())
        .get(`/boards/${boardId}/items`)
        .set('Cookie', cookie)
        .expect(200);
      const item = itemListResponseSchema.parse(response.body).find((item) => item.id === id);
      if (
        (item?.kind === 'image' && item.asset.status === 'ready') ||
        (item?.kind === 'link' && item.preview.status === 'ready')
      ) {
        return item;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Media never became ready');
  }
  it('authorizes uploads and item reads while rejecting malformed media bodies', async () => {
    await request(app.getHttpServer())
      .post(`/boards/${boardId}/assets/presign`)
      .send({ mime: 'image/png', bytes: 3 })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/boards/${boardId}/assets/presign`)
      .set('Cookie', cookie)
      .send({ mime: 'image/svg+xml', bytes: 3 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/boards/${boardId}/items`)
      .set('Cookie', cookie)
      .send({ id: randomUUID(), kind: 'link', url: 'http://user:secret@example.com', zOrder: 'a0' })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/assets/${randomUUID()}/url?variant=raw`)
      .set('Cookie', cookie)
      .expect(400);
  });
  it('processes a signed image upload and a shared link through actual BullMQ workers', async () => {
    const body = await sharp({
      create: { width: 100, height: 50, channels: 3, background: '#338899' },
    })
      .png()
      .toBuffer();
    const reservation = await request(app.getHttpServer())
      .post(`/boards/${boardId}/assets/presign`)
      .set('Cookie', cookie)
      .send({ mime: 'image/png', bytes: body.length })
      .expect(201);
    const upload = presignResponseSchema.parse(reservation.body);
    expect(
      (
        await fetch(upload.url, {
          method: 'PUT',
          headers: upload.headers,
          body: new Uint8Array(body),
        })
      ).status,
    ).toBe(200);
    const id = randomUUID();
    const created = await request(app.getHttpServer())
      .post(`/boards/${boardId}/items`)
      .set('Cookie', cookie)
      .send({ id, kind: 'image', assetId: upload.assetId, zOrder: 'a0' })
      .expect(201);
    expect(itemResponseSchema.parse(created.body).kind).toBe('image');
    await request(app.getHttpServer())
      .get(`/assets/${upload.assetId}/url`)
      .set('Cookie', cookie)
      .expect(409);
    const linkId = randomUUID();
    await request(app.getHttpServer())
      .post(`/boards/${boardId}/items`)
      .set('Cookie', cookie)
      .send({ id: linkId, kind: 'link', url: 'https://example.com/product#section', zOrder: 'b0' })
      .expect(201);
    runtime = new WorkerRuntime(
      source,
      storage,
      new MediaProcessors(source, storage, {
        fetch: async (url) => ({
          url,
          html: '<meta property="og:title" content="Smoke test lamp">',
        }),
      }),
      {
        databaseUrl: testDatabaseUrl(),
        redisUrl: testRedisUrl(),
        prefix: `smoke-${randomUUID()}`,
        port: 0,
      },
    );
    await runtime.start();
    const health = `http://127.0.0.1:${runtime.healthPort}`;
    expect((await fetch(`${health}/health/live`)).status).toBe(200);
    expect((await fetch(`${health}/health/ready`)).status).toBe(200);
    const readiness = jest.spyOn(storage, 'ready').mockRejectedValue(new Error('Storage offline'));
    try {
      expect((await fetch(`${health}/health/ready`)).status).toBe(503);
    } finally {
      readiness.mockRestore();
    }
    const image = await waitReady(id);
    expect(image.kind).toBe('image');
    const link = await waitReady(linkId);
    if (link.kind !== 'link') {
      throw new Error('Expected link');
    }
    expect(link.preview.title).toBe('Smoke test lamp');
    const signed = await request(app.getHttpServer())
      .get(`/assets/${upload.assetId}/url`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      Buffer.from(await (await fetch(assetUrlResponseSchema.parse(signed.body).url)).arrayBuffer()),
    ).toEqual(body);
    const retry = await request(app.getHttpServer())
      .post(`/boards/${boardId}/items`)
      .set('Cookie', cookie)
      .send({ id, kind: 'image', assetId: randomUUID(), zOrder: 'z9' })
      .expect(200);
    expect(retry.body.id).toBe(id);
    const moved = await request(app.getHttpServer())
      .patch(`/items/${id}/position`)
      .set('Cookie', cookie)
      .send({ x: 42 })
      .expect(200);
    expect(moved.body.version).toBe(1);
    await request(app.getHttpServer())
      .patch(`/items/${id}`)
      .set('Cookie', cookie)
      .send({ version: 1, title: 'Image title' })
      .expect(200);
    const conflict = await request(app.getHttpServer())
      .patch(`/items/${id}`)
      .set('Cookie', cookie)
      .send({ version: 1, title: 'stale' })
      .expect(409);
    expect(conflict.body.currentItem.kind).toBe('image');
    await request(app.getHttpServer())
      .patch(`/items/${id}`)
      .set('Cookie', cookie)
      .send({ version: 2, assetId: randomUUID() })
      .expect(400);
  }, 20000);
  it('continues note operations when media storage is unavailable', async () => {
    const media = app.get(MediaStorage);
    const spy = jest.spyOn(media, 'require').mockImplementation(() => {
      throw new ServiceUnavailableException('Storage offline');
    });
    try {
      await request(app.getHttpServer())
        .post(`/boards/${boardId}/items`)
        .set('Cookie', cookie)
        .send({ id: randomUUID(), kind: 'note', zOrder: 'c0', note: 'still works' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/boards/${boardId}/assets/presign`)
        .set('Cookie', cookie)
        .send({ mime: 'image/png', bytes: 3 })
        .expect(503);
    } finally {
      spy.mockRestore();
    }
  });
});
