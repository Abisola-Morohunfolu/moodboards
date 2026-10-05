import 'reflect-metadata';
import { DataSource, EntityManager, MigrationInterface } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

export interface DatabaseConfig {
  url: string;
  poolMax?: number;
  migrations?: (new () => MigrationInterface)[];
}

export function databaseOptions(config: DatabaseConfig): PostgresConnectionOptions {
  return {
    type: 'postgres',
    url: config.url,
    poolSize: config.poolMax ?? 10,
    connectTimeoutMS: 2000,
    extra: {
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 30000,
      statement_timeout: 2000,
    },
    poolErrorHandler: () => console.error('Database pool connection failed'),
    installExtensions: false,
    synchronize: false,
    migrationsRun: false,
    migrationsTransactionMode: 'all',
    migrationsTableName: 'migrations',
    migrations: config.migrations ?? [],
    entities: [],
    logging: false,
  };
}

export function createDataSource(config: DatabaseConfig): DataSource {
  return new DataSource(databaseOptions(config));
}

export function withTransaction<T>(
  dataSource: DataSource,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return dataSource.transaction(work);
}

export type { DataSource, EntityManager } from 'typeorm';

// Callers validate event contracts and acquire resource locks before board locks.
export async function resourceLock(manager: EntityManager, key: string): Promise<void> {
  await manager.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}
export async function appendBoardEvent(
  manager: EntityManager,
  boardId: string,
  participantId: string | null,
  event: { type: string; payload: unknown },
): Promise<string> {
  const rows: { event_seq: string }[] = await manager.query(
    'with advanced as (update boards set event_seq=event_seq+1 where id=$1 returning event_seq) select event_seq from advanced',
    [boardId],
  );
  if (!rows[0]) {
    throw new Error('Cannot append an event to a missing board');
  }
  await manager.query(
    'insert into board_events (board_id,board_seq,participant_id,type,payload) values ($1,$2,$3,$4,$5::jsonb)',
    [boardId, rows[0].event_seq, participantId, event.type, JSON.stringify(event.payload)],
  );
  return rows[0].event_seq;
}
