import type { DataSource, QueryRunner } from 'typeorm';

export async function migrationsApplied(
  source: DataSource,
  runner?: QueryRunner,
): Promise<boolean> {
  const executor: Pick<DataSource, 'query'> = runner ?? source;
  // showMigrations() creates a missing history table. Health checks must only read.
  const [table] = await executor.query<{ present: boolean }[]>(
    "select to_regclass('public.migrations') is not null as present",
  );
  if (!table?.present) {
    return false;
  }
  const rows = await executor.query<{ name: string }[]>('select name from public.migrations');
  const applied = new Set(rows.map(({ name }) => name));
  return source.migrations.every((migration) =>
    applied.has(migration.name ?? migration.constructor.name),
  );
}
