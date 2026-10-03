import { setTimeout as delay } from 'node:timers/promises';
import { RateLimitService } from '../apps/api/src/features/auth/rate-limit.service';
import { tokenHash } from '../apps/api/src/features/auth/cookies';
import { testRateLimitStore } from './redis';

describe('Redis authentication rate limits', () => {
  const stores = [testRateLimitStore(), testRateLimitStore()];
  const instances = stores.map((store) => new RateLimitService(store));
  const response = { setHeader: jest.fn() } as unknown as Parameters<
    RateLimitService['enforce']
  >[3];
  const key = `moodboard:auth:rate-limit:login:ip:${tokenHash('ip')}`;
  beforeAll(async () => {
    await Promise.all(stores.map((store) => store.client.connect()));
  });
  beforeEach(async () => {
    await stores[0]!.client.flushDb();
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await stores[0]!.client.flushDb();
    stores.forEach((store) => store.onApplicationShutdown());
  });
  it('enforces one shared limit under concurrent requests from separate connections', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        instances[index % 2]!.enforce('login', 'ip', 10, response),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(10);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(2);
    rejected.forEach((result) => expect(result.reason.getStatus()).toBe(429));
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    expect(await stores[0]!.client.get(key)).toBe('12');
    expect(await stores[0]!.client.ttl(key)).toBeGreaterThan(0);
  });
  it('expires counters without extending the window on later attempts', async () => {
    await instances[0]!.enforce('login', 'ip', 1, response);
    await stores[0]!.client.pExpire(key, 100);
    await expect(instances[1]!.enforce('login', 'ip', 1, response)).rejects.toMatchObject({
      status: 429,
    });
    expect(await stores[0]!.client.pTTL(key)).toBeLessThanOrEqual(100);
    await delay(150);
    await expect(instances[1]!.enforce('login', 'ip', 1, response)).resolves.toBeUndefined();
    expect(await stores[0]!.client.get(key)).toBe('1');
    expect(await stores[0]!.client.ttl(key)).toBeGreaterThan(55);
  });
  it('shares the email limit across IPs while keeping routes independent', async () => {
    await instances[0]!.enforce('login', 'ip-a', 1, response, 'planner@example.com');
    await expect(
      instances[1]!.enforce('login', 'ip-b', 1, response, 'planner@example.com'),
    ).rejects.toMatchObject({ status: 429 });
    await expect(instances[1]!.enforce('signup', 'ip-a', 1, response)).resolves.toBeUndefined();
    const keys = await stores[0]!.client.keys('*');
    expect(keys.some((value) => value.includes('planner@example.com'))).toBe(false);
  });
  it('shares the IP limit across different emails', async () => {
    await instances[0]!.enforce('login', 'ip', 1, response, 'first@example.com');
    await expect(
      instances[1]!.enforce('login', 'ip', 1, response, 'second@example.com'),
    ).rejects.toMatchObject({ status: 429 });
  });
});
