import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@redis/client';
import { ApiConfig } from '../../config';

// Start the window only on the first attempt. Increment and expiry must be atomic.
const incrementScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('PTTL', KEYS[1])}
`;

@Injectable()
export class RedisRateLimitStore implements OnModuleInit, OnApplicationShutdown {
  readonly client;
  private readonly logger = new Logger(RedisRateLimitStore.name);

  constructor(config: ConfigService<ApiConfig, true>) {
    this.client = createClient({
      url: config.get('REDIS_URL', { infer: true }),
      disableOfflineQueue: true,
      commandsQueueMaxLength: 1000,
      commandOptions: { timeout: 1000 },
      // Keep healthy idle sockets active while bounding silent handshakes too.
      pingInterval: 500,
      socket: {
        connectTimeout: 1000,
        socketTimeout: 1000,
        reconnectStrategy: (retries) => Math.min(100 * 2 ** Math.min(retries, 5), 2000),
      },
    });
    // Connection errors can include credentials; log only a fixed message.
    this.client.on('error', () => this.logger.warn('Redis rate-limit connection unavailable'));
  }

  onModuleInit(): void {
    // Redis outages must not prevent startup or existing Postgres sessions working.
    if (!this.client.isOpen) {
      void this.client.connect().catch(() => {});
    }
  }

  async increment(key: string): Promise<{ count: number; retry: number }> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Discard a stalled socket and pending replies before reconnecting.
          // Retrying an uncertain INCR here could count an attempt twice.
          if (this.client.isOpen) {
            this.client.destroy();
            this.onModuleInit();
          }
          reject(new Error('Redis rate-limit request timed out'));
        }, 1000);
      });
      const [count, ttl] = (await Promise.race([
        this.client.eval(incrementScript, { keys: [key], arguments: ['60'] }),
        deadline,
      ])) as [number, number];
      return { count, retry: Math.max(1, Math.ceil(ttl / 1000)) };
    } finally {
      clearTimeout(timer);
    }
  }

  onApplicationShutdown(): void {
    if (this.client.isOpen) {
      this.client.destroy();
    }
  }
}
