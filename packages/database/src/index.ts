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
