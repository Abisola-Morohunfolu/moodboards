import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Response } from 'express';
import { tokenHash } from './cookies';

@Injectable()
export class RateLimitService {
  constructor(private readonly source: DataSource) {}
  async enforce(
    route: string,
    ip: string,
    limit: number,
    response: Response,
    email?: string,
  ): Promise<void> {
    await this.source.query(`delete from auth_rate_limits where key in
      (select key from auth_rate_limits where expires_at<=now() order by expires_at limit 50)`);
    await this.source.query(`delete from google_auth_attempts where state_hash in
      (select state_hash from google_auth_attempts where expires_at<=now() order by expires_at limit 50)`);
    const keys = [`${route}:ip:${tokenHash(ip)}`];
    if (email) {
      keys.push(`${route}:email:${tokenHash(email)}`);
    }
    for (const key of keys) {
      const [row] = await this.source.query<{ count: number; retry: number }[]>(
        `
        insert into auth_rate_limits (key, count, expires_at) values ($1, 1, now()+interval '1 minute')
        on conflict (key) do update set
          count=case when auth_rate_limits.expires_at<=now() then 1 else auth_rate_limits.count+1 end,
          expires_at=case when auth_rate_limits.expires_at<=now() then now()+interval '1 minute' else auth_rate_limits.expires_at end
        returning count, greatest(1, ceil(extract(epoch from expires_at-now())))::int as retry`,
        [key],
      );
      if (row!.count > limit) {
        response.setHeader('Retry-After', row!.retry);
        throw new HttpException('Too many authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }
}
