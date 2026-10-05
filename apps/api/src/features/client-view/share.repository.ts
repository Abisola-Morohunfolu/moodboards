import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { z } from 'zod';
import { SESSION_SECONDS, randomToken, tokenHash } from '../auth/cookies';
import { lockContactParents, ContactPrincipal } from '../access/contact-access';
import { ContactLinks, validContactSignature } from '../access/contact-links';
import { AccessRepository, boardResponse } from '../access/access.repository';

@Injectable()
export class ShareRepository {
  constructor(
    private readonly links: ContactLinks,
    private readonly access: AccessRepository,
  ) {}
  async exchange(manager: EntityManager, input: string) {
    const { secret, fingerprint } = this.links.configuration();
    const parts = input.split('.');
    const parsedId = z.uuid().safeParse(parts[0]);
    if (parts.length !== 2 || !parsedId.success || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) {
      throw new NotFoundException('Link not found');
    }
    const participantId = parsedId.data.toLowerCase();
    const [identity] = await manager.query<{ contact_id: string; board_id: string }[]>(
      'select contact_id,board_id from board_participants where id=$1 and contact_id is not null',
      [participantId],
    );
    if (!identity) {
      throw new NotFoundException('Link not found');
    }
    await lockContactParents(manager, identity.contact_id);
    await manager.query('select id from boards where id=$1 for update', [identity.board_id]);
    const [assignment] = await manager.query<{ link_version: number }[]>(
      `select p.link_version from board_participants p
      join client_contacts c on c.id=p.contact_id
      join boards b on b.id=p.board_id and b.client_id=c.client_id
      where p.id=$1 and c.removed_at is null and p.revoked_at is null
      and p.role in ('viewer','approver') and (p.expires_at is null or p.expires_at>clock_timestamp())`,
      [participantId],
    );
    if (
      !assignment ||
      !validContactSignature(secret, participantId, assignment.link_version, parts[1]!)
    ) {
      throw new NotFoundException('Link not found');
    }
    const token = randomToken();
    const principal: ContactPrincipal = {
      kind: 'contact',
      participantId,
      contactId: identity.contact_id,
      boardId: identity.board_id,
      sessionHash: tokenHash(token),
      secretFingerprint: fingerprint,
    };
    await manager.query(
      `insert into contact_sessions(token_hash,participant_id,contact_id,board_id,link_version,secret_fingerprint,expires_at)
      values($1,$2,$3,$4,$5,$6,now()+$7*interval '1 second')`,
      [
        principal.sessionHash,
        participantId,
        identity.contact_id,
        identity.board_id,
        assignment.link_version,
        fingerprint,
        SESSION_SECONDS,
      ],
    );
    const access = await this.access.loadContact(manager, principal, identity.board_id);
    return { token, response: { board: boardResponse(access.board), role: access.role } };
  }
}
