import { createDataSource } from '@moodboard/database';
import { migrations } from '../apps/api/src/database/migrations';

export function testDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error('Set TEST_DATABASE_URL to the disposable moodboard_test database');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid TEST_DATABASE_URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/moodboard_test') {
    throw new Error('Database tests require the disposable moodboard_test database');
  }
  if (process.env.DATABASE_URL) {
    const development = new URL(process.env.DATABASE_URL);
    if (
      development.hostname === url.hostname &&
      (development.port || '5432') === (url.port || '5432') &&
      development.pathname === url.pathname
    ) {
      throw new Error('Test and development databases must differ');
    }
  }
  return value;
}

export function testDataSource(poolMax = 2) {
  return createDataSource({ url: testDatabaseUrl(), poolMax, migrations });
}
