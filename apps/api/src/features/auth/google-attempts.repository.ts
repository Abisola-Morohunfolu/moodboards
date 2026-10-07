import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GoogleAuthAttemptEntity, entityFromRow } from '@moodboard/database';

export type GoogleAttempt = Pick<GoogleAuthAttemptEntity, 'nonce' | 'pkceVerifier'>;
@Injectable()
export class GoogleAttemptsRepository {
  constructor(private readonly source: DataSource) {}
  async create(stateHash: string, nonce: string, pkceVerifier: string): Promise<void> {
    const manager = this.source.manager;
    const expired = manager
      .createQueryBuilder(GoogleAuthAttemptEntity, 'attempt')
      .select('attempt.stateHash')
      .where('attempt.expiresAt <= now()')
      .orderBy('attempt.expiresAt')
      .limit(50);
    await manager
      .createQueryBuilder()
      .delete()
      .from(GoogleAuthAttemptEntity)
      .where(`state_hash IN (${expired.getQuery()})`)
      .setParameters(expired.getParameters())
      .execute();
    await manager
      .createQueryBuilder()
      .insert()
      .into(GoogleAuthAttemptEntity)
      .values({ stateHash, nonce, pkceVerifier, expiresAt: () => "now() + interval '10 minutes'" })
      .execute();
  }
  async consume(stateHash: string): Promise<GoogleAttempt | undefined> {
    // DELETE RETURNING consumes an attempt atomically across API processes.
    const result = await this.source.manager
      .createQueryBuilder()
      .delete()
      .from(GoogleAuthAttemptEntity)
      .where('state_hash = :stateHash AND expires_at > now()', { stateHash })
      .returning(['nonce', 'pkceVerifier'])
      .execute();
    return result.raw[0]
      ? entityFromRow(this.source.manager, GoogleAuthAttemptEntity, result.raw[0])
      : undefined;
  }
}
