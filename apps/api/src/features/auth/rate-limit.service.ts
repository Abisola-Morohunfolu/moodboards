import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { tokenHash } from './cookies';
import { RedisRateLimitStore } from './redis-rate-limit.store';

@Injectable()
export class RateLimitService {
  constructor(private readonly store: RedisRateLimitStore) {}
  async enforce(
    route: string,
    ip: string,
    limit: number,
    response: Response,
    email?: string,
  ): Promise<void> {
    const keys = [`moodboard:auth:rate-limit:${route}:ip:${tokenHash(ip)}`];
    if (email) {
      keys.push(`moodboard:auth:rate-limit:${route}:email:${tokenHash(email)}`);
    }
    for (const key of keys) {
      let row: { count: number; retry: number };
      try {
        row = await this.store.increment(key);
      } catch {
        throw new ServiceUnavailableException('Authentication temporarily unavailable');
      }
      if (row.count > limit) {
        response.setHeader('Retry-After', row.retry);
        throw new HttpException('Too many authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }
}
