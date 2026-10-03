import { withTransaction } from '@moodboard/database';
import { testDataSource } from './database';

describe('Database pool and transactions', () => {
  const source = testDataSource(1);
  beforeAll(async () => {
    await source.initialize();
    await source.query('create table foundation_probe (id integer primary key)');
  });
  afterEach(async () => {
    await source.query('truncate foundation_probe');
  });
  afterAll(async () => {
    if (source.isInitialized) {
      await source.query('drop table if exists foundation_probe');
      await source.destroy();
    }
  });
  it('reuses a pooled connection', async () => {
    const first = await source.query('select pg_backend_pid() as pid');
    expect(await source.query('select pg_backend_pid() as pid')).toEqual(first);
  });
  it('commits both writes on one transaction connection', async () => {
    const result = await withTransaction(source, async (manager) => {
      const first = await manager.query('select pg_backend_pid() as pid');
      await manager.query('insert into foundation_probe values (1)');
      await manager.query('insert into foundation_probe values (2)');
      expect(await manager.query('select pg_backend_pid() as pid')).toEqual(first);
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(await source.query('select count(*)::int as count from foundation_probe')).toEqual([
      { count: 2 },
    ]);
  });
  it('rolls back both writes after a database error and releases the connection', async () => {
    await expect(
      withTransaction(source, async (manager) => {
        await manager.query('insert into foundation_probe values (1)');
        await manager.query('insert into foundation_probe values (1)');
      }),
    ).rejects.toThrow();
    expect(await source.query('select * from foundation_probe')).toEqual([]);
  });
  it('preserves an application error and releases the connection', async () => {
    const failure = new Error('Stop transaction');
    await expect(
      withTransaction(source, async (manager) => {
        await manager.query('insert into foundation_probe values (1)');
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await source.query('select * from foundation_probe')).toEqual([]);
  });
  it('closes all connections when the data source stops', async () => {
    const disposable = testDataSource(1);
    await disposable.initialize();
    await disposable.destroy();
    expect(disposable.isInitialized).toBe(false);
    await expect(disposable.query('select 1')).rejects.toThrow();
  });
});
