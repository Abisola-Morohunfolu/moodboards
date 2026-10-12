import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../apps/api/dist/app.module.js';
import { configureHttp } from '../apps/api/dist/app.setup.js';
import { apiDataSource } from '../apps/api/dist/database/data-source.js';
import { MediaStorage } from '../apps/api/dist/platform/storage/storage.module.js';
import { R2Storage, r2EnvironmentSchema } from '../packages/storage/dist/index.js';
import { MediaQueues } from '../apps/worker/dist/queues/media.js';
import { WorkerRuntime } from '../apps/worker/dist/runtime.js';
import { MediaProcessors } from '../apps/worker/dist/jobs/processors.js';

// This harness can never connect to a production database, Redis, or R2 bucket.
function localUrl(value, protocols, pathname) {
  const url = new URL(value ?? '');
  if (
    !protocols.includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== pathname ||
    url.search ||
    url.hash
  ) {
    throw new Error('Browser tests require explicit disposable loopback services');
  }
  return url;
}
const databaseUrl = localUrl(
  process.env.TEST_DATABASE_URL,
  ['postgres:', 'postgresql:'],
  '/moodboard_test',
).href;
const redisUrl = localUrl(process.env.TEST_REDIS_URL, ['redis:'], '/15').href;
const endpoint = localUrl(process.env.TEST_STORAGE_ENDPOINT, ['http:'], '/').href;
const bucket = process.env.TEST_STORAGE_BUCKET;
if (
  !bucket?.startsWith('moodboard-test-') ||
  bucket === process.env.R2_BUCKET ||
  databaseUrl === process.env.DATABASE_URL
) {
  throw new Error('Browser tests require a separate disposable database and bucket');
}
const storage = new R2Storage(
  r2EnvironmentSchema.parse({
    R2_ACCOUNT_ID: '0'.repeat(32),
    R2_BUCKET: bucket,
    R2_ACCESS_KEY_ID: 'moodboard_test',
    R2_SECRET_ACCESS_KEY: 'moodboard_test_secret',
  }),
  new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'moodboard_test', secretAccessKey: 'moodboard_test_secret' },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }),
);
try {
  await storage.client.send(new CreateBucketCommand({ Bucket: bucket }));
} catch (error) {
  if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) {
    throw error;
  }
}
// Disposable MinIO CORS is configured on the test service; R2 requires bucket CORS.
const source = apiDataSource({ DATABASE_URL: databaseUrl });
await source.initialize();
await source.runMigrations();
const module = await Test.createTestingModule({
  imports: [
    AppModule.forRoot({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:3010',
      AUTH_TRUSTED_PROXIES: '127.0.0.1',
      LINK_SECRET: 'browser-smoke-secret-'.repeat(4),
      PUBLIC_WEB_URL: 'http://127.0.0.1:3010',
      PUBLIC_API_URL: 'http://127.0.0.1:3011',
    }),
  ],
})
  .overrideProvider(DataSource)
  .useValue(source)
  .overrideProvider(MediaStorage)
  .useValue({ storage, maxBytes: storage.config.MEDIA_UPLOAD_MAX_BYTES, require: () => storage })
  .compile();
const app = module.createNestApplication({ logger: false });
// Synthetic test clients pass distinct proxy IPs; production CORS still only allows Content-Type.
app.enableCors({
  origin: 'http://127.0.0.1:3010',
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-Forwarded-For'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
});
configureHttp(app);
const runtime = new WorkerRuntime(source, storage, new MediaProcessors(source, storage), {
  databaseUrl,
  redisUrl,
  prefix: `browser-${randomUUID()}`,
  port: 3012,
});
await runtime.start();
await app.listen(3011, '127.0.0.1');
console.info('Disposable browser API and real media worker ready on 3011/3012');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (stopping) {
      return;
    }
    stopping = true;
    void (async () => {
      await runtime.close();
      const cleanup = new MediaQueues(redisUrl, runtime.queues.prefix);
      try {
        for (const queue of Object.values(cleanup.queues)) {
          await queue.waitUntilReady();
          await queue.obliterate({ force: true });
        }
      } finally {
        await cleanup.close();
      }
      await app.close();
      storage.close();
      if (source.isInitialized) {
        await source.destroy();
      }
    })().catch(() => {
      process.exitCode = 1;
    });
  });
}
