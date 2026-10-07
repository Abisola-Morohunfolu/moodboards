import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContactSessionEntity } from '@moodboard/database';
import { tokenHash } from '../auth/cookies';
import { ContactLinks } from './contact-links';
import { ContactPrincipal, ContactSessionIdentity, contactSessionQuery } from './contact-access';

@Injectable()
export class ContactSessionRepository {
  constructor(
    private readonly source: DataSource,
    private readonly links: ContactLinks,
  ) {}
  async resolve(token: string): Promise<ContactPrincipal | undefined> {
    const fingerprint = this.links.fingerprint();
    if (!fingerprint) {
      return undefined;
    }
    const hash = tokenHash(token);
    const row = await contactSessionQuery(
      this.source.manager,
      hash,
      fingerprint,
    ).getRawOne<ContactSessionIdentity>();
    return row
      ? { kind: 'contact', ...row, sessionHash: hash, secretFingerprint: fingerprint }
      : undefined;
  }
  async revoke(hash: string): Promise<void> {
    await this.source.manager
      .createQueryBuilder()
      .delete()
      .from(ContactSessionEntity)
      .where('token_hash = :hash', { hash })
      .execute();
  }
}
