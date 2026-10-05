import { R2Storage, r2Config } from './index';

describe('R2 configuration and signed access', () => {
  const environment = {
    R2_ACCOUNT_ID: 'a'.repeat(32),
    R2_BUCKET: 'moodboard-assets',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
  };
  it('disables media when all R2 fields are absent or empty', () => {
    expect(r2Config({})).toBeNull();
    expect(
      r2Config(Object.fromEntries(Object.keys(environment).map((key) => [key, '']))),
    ).toBeNull();
  });
  it.each(Object.keys(environment))('rejects partial configuration missing %s', (key) => {
    expect(() => r2Config({ ...environment, [key]: '' })).toThrow('Invalid R2 configuration');
    expect(() => r2Config({ [key]: environment[key as keyof typeof environment] })).toThrow(
      'Invalid R2 configuration',
    );
  });
  it('rejects an account ID that could alter the derived endpoint without exposing credentials', () => {
    expect(() => r2Config({ ...environment, R2_ACCOUNT_ID: 'invalid/account' })).toThrow(
      /^Invalid R2 configuration$/,
    );
  });
  it('keeps the upload cap and ignores endpoint and region overrides', async () => {
    const config = r2Config({
      ...environment,
      R2_ENDPOINT: 'https://other.example.com',
      R2_REGION: 'other-region',
      MEDIA_UPLOAD_MAX_BYTES: '1024',
    })!;
    expect(config.MEDIA_UPLOAD_MAX_BYTES).toBe(1024);
    const storage = new R2Storage(config);
    try {
      const put = await storage.presignPut('staging/fixture.png', 'image/png', 123);
      const url = new URL(put.url);
      expect(url.hostname).toMatch(
        new RegExp(`(^|\\.)${environment.R2_ACCOUNT_ID}\\.r2\\.cloudflarestorage\\.com$`),
      );
      expect(url.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
        expect.arrayContaining(['content-type', 'content-length', 'host']),
      );
      expect(put.headers).toEqual({ 'Content-Type': 'image/png', 'Content-Length': '123' });
      const get = new URL((await storage.presignGet('media/fixture.png', 'image/png')).url);
      expect(get.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(get.searchParams.get('response-content-type')).toBe('image/png');
      expect(get.searchParams.get('response-cache-control')).toBe('private, max-age=300');
      expect(get.pathname).toContain('media/fixture.png');
    } finally {
      storage.close();
    }
  });
});
