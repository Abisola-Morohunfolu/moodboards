import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  BoardEntity,
  BoardParticipantEntity,
  ClientContactEntity,
  ContactSessionEntity,
} from '@moodboard/database';
import { z } from 'zod';
import { SESSION_SECONDS, randomToken, tokenHash } from '../auth/cookies';
import { lockContactParents, ContactPrincipal } from '../access/contact-access';
import { ContactLinks, validContactSignature } from '../access/contact-links';
import { AccessRepository } from '../access/access.repository';
import { boardResponse } from '../access/access.mapper';

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
    const identity = await manager
      .createQueryBuilder(BoardParticipantEntity, 'participant')
      .select(['participant.id', 'participant.contactId', 'participant.boardId'])
      .where('participant.id = :participantId AND participant.contactId IS NOT NULL', {
        participantId,
      })
      .getOne();
    if (!identity) {
      throw new NotFoundException('Link not found');
    }
    await lockContactParents(manager, identity.contactId!);
    await manager
      .createQueryBuilder(BoardEntity, 'board')
      .select(['board.id'])
      .where('board.id = :boardId', { boardId: identity.boardId })
      .setLock('pessimistic_write')
      .getOne();
    const assignment = await manager
      .createQueryBuilder(BoardParticipantEntity, 'participant')
      .select(['participant.id', 'participant.linkVersion'])
      .innerJoin(ClientContactEntity, 'contact', 'contact.id = participant.contactId')
      .innerJoin(
        BoardEntity,
        'board',
        'board.id = participant.boardId AND board.clientId = contact.clientId',
      )
      .where('participant.id = :participantId', { participantId })
      .andWhere('contact.removedAt IS NULL AND participant.revokedAt IS NULL')
      .andWhere(
        "participant.role IN ('viewer', 'approver') AND (participant.expiresAt IS NULL OR participant.expiresAt > clock_timestamp())",
      )
      .getOne();
    if (
      !assignment ||
      !validContactSignature(secret, participantId, assignment.linkVersion, parts[1]!)
    ) {
      throw new NotFoundException('Link not found');
    }
    const token = randomToken();
    const principal: ContactPrincipal = {
      kind: 'contact',
      participantId,
      contactId: identity.contactId!,
      boardId: identity.boardId,
      sessionHash: tokenHash(token),
      secretFingerprint: fingerprint,
    };
    await manager
      .createQueryBuilder()
      .insert()
      .into(ContactSessionEntity)
      .values({
        tokenHash: principal.sessionHash,
        participantId,
        contactId: principal.contactId,
        boardId: principal.boardId,
        linkVersion: assignment.linkVersion,
        secretFingerprint: fingerprint,
        expiresAt: () => "now() + :seconds * interval '1 second'",
      })
      .setParameter('seconds', SESSION_SECONDS)
      .execute();
    const access = await this.access.loadContact(manager, principal, identity.boardId);
    return { token, response: { board: boardResponse(access.board), role: access.role } };
  }
}
