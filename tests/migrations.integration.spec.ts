import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource, MigrationInterface, QueryRunner } from 'typeorm';
import { InitialSchema1790985600000 } from '../apps/api/src/database/migrations/1790985600000-initial-schema';
import { migrationsApplied } from '../apps/api/src/database/migration-status';
import { testDataSource } from './database';

class FailingMigration1790985600001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('create table failed_migration_probe (id int primary key)');
    await runner.query('select * from missing_migration_table');
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('drop table failed_migration_probe');
  }
}

async function schemaObjects(source: DataSource, schema: string): Promise<unknown> {
  const queries = [
    `select c.relname, a.attname, a.attnum, format_type(a.atttypid, a.atttypmod) as type,
       a.attnotnull, a.attidentity, pg_get_expr(d.adbin, d.adrelid) as default_value
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       join pg_attribute a on a.attrelid=c.oid
       left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
       where n.nspname=$1 and c.relkind='r' and c.relname <> 'migrations' and a.attnum>0 and not a.attisdropped
       order by c.relname, a.attnum`,
    `select c.relname, co.conname, pg_get_constraintdef(co.oid) as definition
       from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace
       where n.nspname=$1 and c.relname <> 'migrations' order by c.relname, co.conname`,
    `select tablename, indexname, indexdef from pg_indexes where schemaname=$1 and tablename <> 'migrations' order by tablename, indexname`,
    `select t.typname, e.enumlabel, e.enumsortorder from pg_type t join pg_namespace n on n.oid=t.typnamespace
       join pg_enum e on e.enumtypid=t.oid where n.nspname=$1 order by t.typname, e.enumsortorder`,
    `select p.proname, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname=$1 and p.proname='notify_board_event' order by p.proname`,
    `select t.tgname, pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid
       join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and not t.tgisinternal order by t.tgname`,
  ];
  const rows = [];
  for (const query of queries) {
    rows.push(await source.query(query, [schema]));
  }
  return JSON.parse(JSON.stringify(rows).replaceAll(`${schema}.`, '').replaceAll('public.', ''));
}

describe('Initial schema migration', () => {
  const source = testDataSource();
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
  });
  afterAll(async () => {
    if (source.isInitialized) {
      await source.destroy();
    }
  });

  it('creates the full schema and records one migration', async () => {
    expect(await migrationsApplied(source)).toBe(true);
    expect(await source.query('select name from migrations')).toEqual([
      { name: 'InitialSchema1790985600000' },
    ]);
    expect(
      await source.query(
        "select count(*)::int as count from pg_tables where schemaname='public' and tablename <> 'migrations'",
      ),
    ).toEqual([{ count: 28 }]);
  });
  it('does not repeat an applied migration', async () => {
    expect(await source.runMigrations()).toEqual([]);
  });
  it('agrees with the reference columns, constraints, indexes, enums, function, and trigger', async () => {
    const runner = source.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('create schema foundation_reference');
      await runner.query('set search_path to foundation_reference, public');
      await runner.query(readFileSync(resolve(__dirname, '../db/schema.sql'), 'utf8'));
      await runner.query('set search_path to public');
      expect(await schemaObjects(source, 'public')).toEqual(
        await schemaObjects(source, 'foundation_reference'),
      );
    } finally {
      await runner.query('set search_path to public');
      await runner.query('drop schema if exists foundation_reference cascade');
      await runner.release();
    }
  });
  it('reverts the application objects and can run again', async () => {
    await source.undoLastMigration();
    try {
      expect(await migrationsApplied(source)).toBe(false);
      expect(
        await source.query(
          "select count(*)::int as count from pg_tables where schemaname='public' and tablename <> 'migrations'",
        ),
      ).toEqual([{ count: 0 }]);
    } finally {
      await source.runMigrations();
    }
    expect(await migrationsApplied(source)).toBe(true);
  });
  it('rolls back a failed migration without a partial table or history record', async () => {
    const failing = testDataSource();
    failing.setOptions({ migrations: [InitialSchema1790985600000, FailingMigration1790985600001] });
    await failing.initialize();
    try {
      await expect(failing.runMigrations()).rejects.toThrow();
      expect(
        await failing.query("select to_regclass('failed_migration_probe') as table_name"),
      ).toEqual([{ table_name: null }]);
      expect(await failing.query('select name from migrations')).toEqual([
        { name: 'InitialSchema1790985600000' },
      ]);
    } finally {
      await failing.destroy();
    }
  });
});
