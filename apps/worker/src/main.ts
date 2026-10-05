import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createDataSource } from '@moodboard/database';
import { R2Storage, r2Config } from '@moodboard/storage';
import { WorkerRuntime } from './runtime';
import { MediaProcessors } from './jobs/processors';
import { redisConnection } from './queues/media';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  const options = r2Config(process.env);
  if (
    !databaseUrl ||
    !redisUrl ||
    !options ||
    !['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)
  ) {
    throw new Error('Invalid worker configuration');
  }
  redisConnection(redisUrl);
  const port = Number(process.env.WORKER_PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid WORKER_PORT');
  }
  const source = createDataSource({ url: databaseUrl });
  const storage = new R2Storage(options);
  const runtime = new WorkerRuntime(source, storage, new MediaProcessors(source, storage), {
    databaseUrl,
    redisUrl,
    host: process.env.WORKER_HOST ?? '127.0.0.1',
    port,
  });
  let stopping = false;
  async function stop() {
    if (stopping) {
      return;
    }
    stopping = true;
    await runtime.close();
    storage.close();
    if (source.isInitialized) {
      await source.destroy();
    }
  }
  try {
    await source.initialize();
    await runtime.start();
  } catch {
    await stop();
    throw new Error('Worker startup failed; check configuration, migrations, Redis, and storage');
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stop().catch(() => {
        process.exitCode = 1;
      });
    });
  }
}
void main().catch(() => {
  console.error('Worker startup failed; check configuration, migrations, Redis, and storage');
  process.exitCode = 1;
});
