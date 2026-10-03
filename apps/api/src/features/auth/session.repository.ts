import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthPrincipal } from './auth.decorators';
import { SESSION_SECONDS, tokenHash } from './cookies';

@Injectable()
export class SessionRepository {
  constructor(private readonly source: DataSource) {}
  async create(manager: EntityManager, userId: string, token: string): Promise<void> {
    await manager.query(
      `insert into auth_sessions (token_hash, user_id, expires_at)
      values ($1, $2, now() + $3 * interval '1 second')`,
      [tokenHash(token), userId, SESSION_SECONDS],
    );
  }
  async resolve(token: string): Promise<AuthPrincipal | undefined> {
    const hash = tokenHash(token);
    const [row] = await this.source.query<{ user_id: string }[]>(
      `select s.user_id from auth_sessions s
      join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and u.deleted_at is null`,
      [hash],
    );
    return row ? { userId: row.user_id, sessionHash: hash } : undefined;
  }
  async revoke(hash: string): Promise<void> {
    await this.source.query('delete from auth_sessions where token_hash=$1', [hash]);
  }
}
