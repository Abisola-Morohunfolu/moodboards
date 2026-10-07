import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuthSessionEntity, UserEntity } from '@moodboard/database';
import { AuthPrincipal } from './auth.decorators';
import { SESSION_SECONDS, tokenHash } from './cookies';

@Injectable()
export class SessionRepository {
  constructor(private readonly source: DataSource) {}
  async create(manager: EntityManager, userId: string, token: string): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(AuthSessionEntity)
      .values({
        tokenHash: tokenHash(token),
        userId,
        expiresAt: () => "now() + :seconds * interval '1 second'",
      })
      .setParameter('seconds', SESSION_SECONDS)
      .execute();
  }
  async resolve(token: string): Promise<AuthPrincipal | undefined> {
    const hash = tokenHash(token);
    const row = await this.source.manager
      .createQueryBuilder(AuthSessionEntity, 'session')
      .select(['session.tokenHash', 'session.userId'])
      .innerJoin(UserEntity, 'user', 'user.id = session.userId')
      .where('session.tokenHash = :hash AND session.expiresAt > now() AND user.deletedAt IS NULL', {
        hash,
      })
      .getOne();
    return row ? { userId: row.userId, sessionHash: hash } : undefined;
  }
  async revoke(hash: string): Promise<void> {
    await this.source.manager
      .createQueryBuilder()
      .delete()
      .from(AuthSessionEntity)
      .where('token_hash = :hash', { hash })
      .execute();
  }
}
