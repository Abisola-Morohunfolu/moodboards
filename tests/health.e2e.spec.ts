import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { liveResponseSchema, readyResponseSchema } from '@moodboard/contracts';
import { AppModule } from '../apps/api/src/app.module';
import { testDatabaseUrl, testDataSource } from './database';
import { testRedisUrl } from './redis';

describe('Health routes with Postgres', () => {
  const source = testDataSource(1);
  let app: INestApplication;
  beforeAll(async () => {
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
  });
  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (source.isInitialized) {
      await source.destroy();
    }
  });
  it('serves both routes without authentication', async () => {
    const live = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(liveResponseSchema.parse(live.body)).toEqual({ status: 'ok' });
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(readyResponseSchema.parse(ready.body)).toEqual({
      status: 'ok',
      checks: { postgres: 'ok', migrations: 'ok' },
    });
  });
  it('returns 503 while a migration is pending', async () => {
    await source.query(
      "update migrations set name='PendingMigration' where name='InitialSchema1790985600000'",
    );
    try {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
      expect(response.body).toEqual({
        status: 'down',
        checks: { postgres: 'ok', migrations: 'down' },
      });
    } finally {
      await source.query(
        "update migrations set name='InitialSchema1790985600000' where name='PendingMigration'",
      );
    }
  });
  it('does not create a missing migration history table', async () => {
    await source.query('alter table migrations rename to health_history_restore');
    try {
      await request(app.getHttpServer()).get('/health/ready').expect(503);
      expect(await source.query("select to_regclass('public.migrations') as table_name")).toEqual([
        { table_name: null },
      ]);
    } finally {
      await source.query('alter table health_history_restore rename to migrations');
    }
  });
  it('returns 503 on a connection error, keeps live available, and recovers on the next request', async () => {
    const runner = source.createQueryRunner();
    const failingQuery = jest
      .spyOn(runner, 'query')
      .mockRejectedValueOnce(new Error('private connection details'));
    const nextRunner = jest.spyOn(source, 'createQueryRunner').mockReturnValueOnce(runner);
    try {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
      expect(response.body).toEqual({
        status: 'down',
        checks: { postgres: 'down', migrations: 'down' },
      });
      await request(app.getHttpServer()).get('/health/live').expect(200);
    } finally {
      failingQuery.mockRestore();
      nextRunner.mockRestore();
    }
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
  it('replaces a terminated database connection', async () => {
    const poolLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(source.query('select pg_terminate_backend(pg_backend_pid())')).rejects.toThrow();
      await request(app.getHttpServer()).get('/health/ready').expect(200);
      expect(poolLog).toHaveBeenCalledWith('Database pool connection failed');
    } finally {
      poolLog.mockRestore();
    }
  });
  it('closes the pool when the application closes', async () => {
    await app.close();
    expect(source.isInitialized).toBe(false);
    await expect(source.query('select 1')).rejects.toThrow();
  });
});
