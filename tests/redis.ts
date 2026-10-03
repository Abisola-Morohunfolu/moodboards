import { RedisRateLimitStore } from '../apps/api/src/features/auth/redis-rate-limit.store';

const developmentUrl = process.env.REDIS_URL;

export function testRedisUrl(): string {
  const value = process.env.TEST_REDIS_URL;
  if (!value || !URL.canParse(value)) {
    throw new Error('Set TEST_REDIS_URL to disposable Redis database 15');
  }
  const url = new URL(value);
  if (!['redis:', 'rediss:'].includes(url.protocol) || url.pathname !== '/15') {
    throw new Error('Redis tests require disposable database 15');
  }
  if (developmentUrl) {
    const development = new URL(developmentUrl);
    if (
      development.hostname === url.hostname &&
      (development.port || '6379') === (url.port || '6379') &&
      development.pathname === url.pathname
    ) {
      throw new Error('Test and development Redis databases must differ');
    }
  }
  return value;
}

export function testRateLimitStore(url = testRedisUrl()): RedisRateLimitStore {
  return new RedisRateLimitStore({
    get: () => url,
  } as unknown as ConstructorParameters<typeof RedisRateLimitStore>[0]);
}
