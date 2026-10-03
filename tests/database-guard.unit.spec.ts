import { testDatabaseUrl } from './database';

describe('Test database guard', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    process.env = original;
  });
  it('requires an explicit test URL', () => {
    delete process.env.TEST_DATABASE_URL;
    expect(() => testDatabaseUrl()).toThrow('Set TEST_DATABASE_URL');
  });
  it.each(['invalid', 'https://localhost/moodboard_test', 'postgres://localhost/moodboard'])(
    'rejects an unsafe test target',
    (url) => {
      process.env.TEST_DATABASE_URL = url;
      expect(() => testDatabaseUrl()).toThrow();
    },
  );
  it('rejects the development database even with different credentials', () => {
    process.env.TEST_DATABASE_URL = 'postgres://test:test@localhost/moodboard_test';
    process.env.DATABASE_URL = 'postgres://other:other@localhost:5432/moodboard_test';
    expect(() => testDatabaseUrl()).toThrow('Test and development databases must differ');
  });
});
