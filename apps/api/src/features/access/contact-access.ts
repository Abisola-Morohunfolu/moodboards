import { UnauthorizedException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  BoardEntity,
  BoardParticipantEntity,
  ClientEntity,
  ClientContactEntity,
  ContactSessionEntity,
} from '@moodboard/database';

export interface ContactPrincipal {
  kind: 'contact';
  participantId: string;
  contactId: string;
  boardId: string;
  sessionHash: string;
  secretFingerprint: string;
}
export type BoardPrincipal = string | ContactPrincipal;
export type ContactSessionIdentity = Pick<
  ContactSessionEntity,
  'participantId' | 'contactId' | 'boardId'
>;

// Parent locks always precede board locks. Removal, assignment, and reads share this order.
export async function lockContactParents(manager: EntityManager, contactId: string): Promise<void> {
  await manager
    .createQueryBuilder(ClientEntity, 'client')
    .select('client.id')
    .innerJoin(ClientContactEntity, 'contact', 'contact.clientId = client.id')
    .where('contact.id = :contactId', { contactId })
    .setLock('pessimistic_write', undefined, ['client'])
    .getRawMany();
  await manager
    .createQueryBuilder(ClientContactEntity, 'contact')
    .select(['contact.id'])
    .where('contact.id = :contactId', { contactId })
    .setLock('pessimistic_write')
    .getOne();
}

export function contactSessionQuery(manager: EntityManager, hash: string, fingerprint: string) {
  return manager
    .createQueryBuilder(ContactSessionEntity, 'session')
    .select('session.participantId', 'participantId')
    .addSelect('session.contactId', 'contactId')
    .addSelect('session.boardId', 'boardId')
    .innerJoin(
      BoardParticipantEntity,
      'participant',
      'participant.id = session.participantId AND participant.boardId = session.boardId AND participant.contactId = session.contactId',
    )
    .innerJoin(ClientContactEntity, 'contact', 'contact.id = session.contactId')
    .innerJoin(
      BoardEntity,
      'board',
      'board.id = session.boardId AND board.clientId = contact.clientId',
    )
    .where('session.tokenHash = :hash AND session.secretFingerprint = :fingerprint', {
      hash,
      fingerprint,
    })
    .andWhere(
      'session.expiresAt > clock_timestamp() AND session.linkVersion = participant.linkVersion',
    )
    .andWhere(
      'contact.removedAt IS NULL AND participant.role IS NOT NULL AND participant.revokedAt IS NULL',
    )
    .andWhere('(participant.expiresAt IS NULL OR participant.expiresAt > clock_timestamp())');
}
export async function assertContactSession(
  manager: EntityManager,
  principal: ContactPrincipal,
): Promise<void> {
  const row = await contactSessionQuery(
    manager,
    principal.sessionHash,
    principal.secretFingerprint,
  ).getRawOne<ContactSessionIdentity>();
  if (
    !row ||
    row.participantId !== principal.participantId ||
    row.contactId !== principal.contactId ||
    row.boardId !== principal.boardId
  ) {
    throw new UnauthorizedException('Client session required');
  }
}
