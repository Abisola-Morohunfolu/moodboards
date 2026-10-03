import { createDataSource } from '@moodboard/database';
import { validateEnvironment } from '../config';
import { migrations } from './migrations';

export function apiDataSource(environment: Record<string, unknown>) {
  const config = validateEnvironment(environment);
  return createDataSource({ url: config.DATABASE_URL, poolMax: config.DB_POOL_MAX, migrations });
}
