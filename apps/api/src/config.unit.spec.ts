import { validateEnvironment } from './config';

describe('API configuration', () => {
  const valid = { DATABASE_URL: 'postgres://test:test@localhost/moodboard_test' };
  it('sets valid defaults', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      API_PORT: 3001,
      API_HOST: '127.0.0.1',
      DB_POOL_MAX: 10,
      REDIS_URL: 'redis://127.0.0.1:6379',
    });
  });
  it.each([
    {},
    { DATABASE_URL: 'invalid' },
    { DATABASE_URL: 'https://localhost/db' },
    { ...valid, API_PORT: 'bad' },
    { ...valid, API_PORT: '0' },
    { ...valid, API_PORT: '65536' },
    { ...valid, DB_POOL_MAX: '0' },
    { ...valid, REDIS_URL: 'invalid' },
    { ...valid, REDIS_URL: 'https://localhost' },
    { ...valid, REDIS_URL: 'redis://localhost/not-a-database' },
    { ...valid, REDIS_URL: 'redis://localhost/0?password=secret' },
  ])('rejects invalid configuration', (environment) => {
    expect(() => validateEnvironment(environment)).toThrow('Invalid API configuration');
  });
  it.each([
    { ...valid, GOOGLE_CLIENT_ID: 'client' },
    { ...valid, AUTH_ALLOWED_ORIGINS: 'http://localhost:3000/path' },
    { ...valid, AUTH_ALLOWED_ORIGINS: '*' },
    { ...valid, NODE_ENV: 'production' },
    {
      ...valid,
      NODE_ENV: 'production',
      AUTH_ALLOWED_ORIGINS: 'https://app.example.com',
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:3001/auth/google/callback',
    },
  ])('rejects invalid authentication configuration', (environment) => {
    expect(() => validateEnvironment(environment)).toThrow('Invalid API configuration');
  });
  it('accepts fully configured HTTPS production authentication', () => {
    expect(
      validateEnvironment({
        ...valid,
        NODE_ENV: 'production',
        AUTH_ALLOWED_ORIGINS: 'https://app.example.com',
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
        GOOGLE_CALLBACK_URL: 'https://api.example.com/auth/google/callback',
      }),
    ).toMatchObject({
      AUTH_ALLOWED_ORIGINS: ['https://app.example.com'],
      GOOGLE_CLIENT_ID: 'client',
    });
  });
  it('does not include credentials in an error', () => {
    expect(() => validateEnvironment({ DATABASE_URL: 'https://user:secret@localhost/db' })).toThrow(
      'Invalid API configuration: DATABASE_URL',
    );
    expect(() =>
      validateEnvironment({ ...valid, REDIS_URL: 'https://user:secret@localhost' }),
    ).toThrow('Invalid API configuration: REDIS_URL');
  });
  it('accepts Redis TLS URLs with credentials and a database number', () => {
    expect(
      validateEnvironment({ ...valid, REDIS_URL: 'rediss://user:secret@redis.example:6380/1' }),
    ).toMatchObject({ REDIS_URL: 'rediss://user:secret@redis.example:6380/1' });
  });
  it('accepts complete R2 credentials and rejects partial configuration safely', () => {
    const r2 = {
      R2_ACCOUNT_ID: 'a'.repeat(32),
      R2_BUCKET: 'moodboard-assets',
      R2_ACCESS_KEY_ID: 'access-key',
      R2_SECRET_ACCESS_KEY: 'private-secret',
    };
    expect(validateEnvironment({ ...valid, ...r2 })).toMatchObject(r2);
    for (const key of Object.keys(r2)) {
      expect(() => validateEnvironment({ ...valid, ...r2, [key]: '' })).toThrow(
        /^Invalid API configuration: R2_BUCKET$/,
      );
    }
    expect(() => validateEnvironment({ ...valid, R2_SECRET_ACCESS_KEY: 'private-secret' })).toThrow(
      /^Invalid API configuration: R2_BUCKET$/,
    );
  });
});
