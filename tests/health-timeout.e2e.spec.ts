import { createServer, connect, Socket } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createDataSource } from '@moodboard/database';
import { AppModule } from '../apps/api/src/app.module';
import { migrations } from '../apps/api/src/database/migrations';
import { testDatabaseUrl } from './database';
import { testRedisUrl } from './redis';

it('discards a stalled readiness connection and recovers with a one-connection pool', async () => {
  const target = new URL(testDatabaseUrl());
  const sockets = new Set<Socket>();
  let stall = false;
  let connections = 0;
  const proxy = createServer((downstream) => {
    connections++;
    const upstream = connect(Number(target.port || 5432), target.hostname);
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => {
        sockets.delete(socket);
      });
    }
    downstream.on('close', () => upstream.destroy());
    upstream.on('close', () => downstream.destroy());
    downstream.on('data', (bytes: Buffer) => {
      // Keep TCP open but stop forwarding queries, so the server's statement
      // timeout cannot help. A new connection forwards normally after recovery.
      if (!stall) {
        upstream.write(bytes);
      }
    });
    upstream.pipe(downstream);
  });
  let app: INestApplication | undefined;
  let source: DataSource | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const address = proxy.address();
    if (!address || typeof address === 'string') {
      throw new Error('Proxy did not listen on a TCP port');
    }
    const url = new URL(target);
    url.hostname = '127.0.0.1';
    url.port = String(address.port);
    source = createDataSource({ url: url.toString(), poolMax: 1, migrations });
    await source.initialize();
    await source.runMigrations();
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot({ DATABASE_URL: testDatabaseUrl(), REDIS_URL: testRedisUrl() })],
    })
      .overrideProvider(DataSource)
      .useValue(source)
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    const [before] = await source.query<{ pid: number }[]>('select pg_backend_pid() as pid');

    stall = true;
    const started = Date.now();
    const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(Date.now() - started).toBeLessThan(3500);
    expect(response.body).toEqual({
      status: 'down',
      checks: { postgres: 'down', migrations: 'down' },
    });
    await request(app.getHttpServer()).get('/health/live').expect(200);

    stall = false;
    await request(app.getHttpServer()).get('/health/ready').expect(200);
    const [after] = await source.query<{ pid: number }[]>('select pg_backend_pid() as pid');
    expect(after?.pid).not.toBe(before?.pid);
    expect(connections).toBe(2);
    expect(source.isInitialized).toBe(true);
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    if (app) {
      await app.close();
    }
    if (source?.isInitialized) {
      await source.destroy();
    }
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
}, 15000);
