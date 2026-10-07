import 'reflect-metadata';
import { BoardEntity, BoardEventEntity, databaseEntities } from './entities';

export * from './entities';
export * from './mapping';
export * from './patch';
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
    entities: databaseEntities,
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
  await manager.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
export async function appendBoardEvent(
  manager: EntityManager,
  boardId: string,
  participantId: string | null,
  event: { type: string; payload: unknown },
): Promise<string> {
  const result = await manager
    .createQueryBuilder()
    .update(BoardEntity)
    .set({ eventSeq: () => 'event_seq + 1' })
    .where('id = :boardId', { boardId })
    .returning(['eventSeq'])
    .execute();
  const row = result.raw[0] as { event_seq: string } | undefined;
  if (!row) {
    throw new Error('Cannot append an event to a missing board');
  }
  await manager
    .createQueryBuilder()
    .insert()
    .into(BoardEventEntity)
    .values({
      boardId,
      boardSeq: row.event_seq,
      participantId,
      type: event.type,
      payload: () => ':payload::jsonb',
    })
    .setParameter('payload', JSON.stringify(event.payload))
    .execute();
  return row.event_seq;
}
