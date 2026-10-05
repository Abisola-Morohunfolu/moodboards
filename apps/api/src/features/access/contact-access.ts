import { UnauthorizedException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface ContactPrincipal {
  kind: 'contact';
  participantId: string;
  contactId: string;
  boardId: string;
  sessionHash: string;
  secretFingerprint: string;
}
export type BoardPrincipal = string | ContactPrincipal;

// Parent locks always precede board locks. Removal, assignment, and reads share this order.
export async function lockContactParents(manager: EntityManager, contactId: string): Promise<void> {
  await manager.query(
    `select c.id from clients c join client_contacts ct on ct.client_id=c.id
    where ct.id=$1 for update of c`,
    [contactId],
  );
  await manager.query('select id from client_contacts where id=$1 for update', [contactId]);
}

export const contactSessionQuery = `select s.participant_id, s.contact_id, s.board_id
  from contact_sessions s
  join board_participants p on p.id=s.participant_id and p.board_id=s.board_id and p.contact_id=s.contact_id
  join client_contacts c on c.id=s.contact_id
  join boards b on b.id=s.board_id and b.client_id=c.client_id
  where s.token_hash=$1 and s.secret_fingerprint=$2 and s.expires_at>clock_timestamp()
    and s.link_version=p.link_version and c.removed_at is null
    and p.role is not null and p.revoked_at is null
    and (p.expires_at is null or p.expires_at>clock_timestamp())`;

export async function assertContactSession(
  manager: EntityManager,
  principal: ContactPrincipal,
): Promise<void> {
  const rows: { participant_id: string; contact_id: string; board_id: string }[] =
    await manager.query(contactSessionQuery, [principal.sessionHash, principal.secretFingerprint]);
  const row = rows[0];
  if (
    !row ||
    row.participant_id !== principal.participantId ||
    row.contact_id !== principal.contactId ||
    row.board_id !== principal.boardId
  ) {
    throw new UnauthorizedException('Client session required');
  }
}
