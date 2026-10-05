import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { R2Storage } from '@moodboard/storage';
import { WorkerRuntime } from '../apps/worker/src/runtime';
import { MediaProcessors } from '../apps/worker/src/jobs/processors';
import { testDataSource, testDatabaseUrl } from './database';
import { testRedisUrl } from './redis';
import { testStorage } from './storage';

describe('Worker shutdown', () => {
  const source = testDataSource(10);
  let storage: R2Storage;
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    storage = await testStorage();
  });
  afterAll(async () => {
    storage?.close();
    await source.destroy();
  });

  it('closes a listener that finishes reconnecting during shutdown', async () => {
    const runtime = new WorkerRuntime(source, storage, new MediaProcessors(source, storage), {
      databaseUrl: testDatabaseUrl(),
      redisUrl: testRedisUrl(),
      prefix: `shutdown-${randomUUID()}`,
      port: 0,
    });
    // Isolate the connection lifecycle from dispatch and maintenance work.
    jest.spyOn(runtime.dispatcher, 'tick').mockResolvedValue();
    jest.spyOn(runtime.maintenance, 'reconcile').mockResolvedValue();
    jest.spyOn(runtime.maintenance, 'daily').mockResolvedValue();
    let markConnected!: (client: Client) => void;
    const connected = new Promise<Client>((resolve) => {
      markConnected = resolve;
    });
    let resume!: () => void;
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const originalConnect: () => Promise<void> = Client.prototype.connect;
    const clients: Client[] = [];
    jest.spyOn(Client.prototype, 'connect').mockImplementation(async function (this: Client) {
      await originalConnect.call(this);
      clients.push(this);
      if (clients.length > 1) {
        markConnected(this);
        await resumed;
      }
    });
    let closing: Promise<void> | undefined;
    try {
      await runtime.start();
      await clients[0]!.end();
      const client = await connected;
      const end = jest.spyOn(client, 'end');
      closing = runtime.close();
      // Let close() pass its HTTP-server shutdown while reconnect is still pending.
      await new Promise<void>((resolve) => setImmediate(resolve));
      resume();
      await closing;
      expect(end).toHaveBeenCalled();
    } finally {
      resume();
      await (closing ?? runtime.close());
      // Also release a leaked client if this regression test fails.
      await clients[1]?.end();
      jest.restoreAllMocks();
    }
  });
});
