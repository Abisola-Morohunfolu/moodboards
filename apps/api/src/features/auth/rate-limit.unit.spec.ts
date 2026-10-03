import { RateLimitService } from './rate-limit.service';
import { RedisRateLimitStore } from './redis-rate-limit.store';

it('fails closed with a generic 503 when Redis rejects a counter write', async () => {
  const store = {
    increment: jest.fn().mockRejectedValue(new Error('private connection details')),
  } as unknown as RedisRateLimitStore;
  const response = { setHeader: jest.fn() } as unknown as Parameters<
    RateLimitService['enforce']
  >[3];
  await expect(
    new RateLimitService(store).enforce('login', 'ip', 10, response),
  ).rejects.toMatchObject({
    status: 503,
    message: 'Authentication temporarily unavailable',
  });
  expect(response.setHeader).not.toHaveBeenCalled();
});
