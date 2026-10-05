import { testStorageOptions } from './storage';

describe('Disposable storage isolation', () => {
  const valid = {
    TEST_STORAGE_ENDPOINT: 'http://127.0.0.1:9002',
    TEST_STORAGE_BUCKET: 'moodboard-test-assets',
  };
  it('accepts only explicitly configured local test storage', () => {
    expect(testStorageOptions(valid)).toEqual({
      endpoint: valid.TEST_STORAGE_ENDPOINT,
      bucket: valid.TEST_STORAGE_BUCKET,
    });
  });
  it.each([
    {},
    { R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'moodboard-assets' },
    { ...valid, TEST_STORAGE_BUCKET: 'moodboard-assets' },
    { ...valid, R2_BUCKET: valid.TEST_STORAGE_BUCKET },
    { ...valid, TEST_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com' },
    { ...valid, TEST_STORAGE_ENDPOINT: 'http://127.0.0.1:9002@remote.example.com' },
    { ...valid, TEST_STORAGE_ENDPOINT: 'http://127.0.0.1:9002/path' },
    { ...valid, TEST_STORAGE_ENDPOINT: 'http://127.0.0.1:9002?remote=true' },
  ])('refuses remote, shared, or missing test storage', (environment) => {
    expect(() => testStorageOptions(environment)).toThrow();
  });
});
