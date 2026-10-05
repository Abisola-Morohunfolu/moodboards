import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { tokenHash } from '../auth/cookies';
import { ContactLinks } from './contact-links';
import { ContactPrincipal, contactSessionQuery } from './contact-access';

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
    const [row] = await this.source.query<
      { participant_id: string; contact_id: string; board_id: string }[]
    >(contactSessionQuery, [hash, fingerprint]);
    return row
      ? {
          kind: 'contact',
          participantId: row.participant_id,
          contactId: row.contact_id,
          boardId: row.board_id,
          sessionHash: hash,
          secretFingerprint: fingerprint,
        }
      : undefined;
  }
  async revoke(hash: string): Promise<void> {
    await this.source.query('delete from contact_sessions where token_hash=$1', [hash]);
  }
}
