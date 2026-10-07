import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AssignContactRequest, UpdateContactParticipantRequest } from '@moodboard/contracts';
import { EntityManager, DataSource } from 'typeorm';
import {
  BoardEntity,
  BoardParticipantEntity,
  ClientContactEntity,
  ClientEntity,
  ContactSessionEntity,
  entityFromRow,
} from '@moodboard/database';
import { lockContactParents } from '../access/contact-access';
import { ContactAssignment, participantResponse } from './participants.mapper';

export function validateExpiry(value: string | null | undefined) {
  if (value && new Date(value).getTime() <= Date.now()) {
    throw new BadRequestException('Expiry must be in the future');
  }
}
@Injectable()
export class ParticipantsRepository {
  constructor(private readonly source: DataSource) {}
  async identity(boardId: string, participantId: string) {
    const row = await this.source.manager
      .createQueryBuilder(BoardParticipantEntity, 'participant')
      .select(['participant.id', 'participant.contactId'])
      .where(
        'participant.boardId = :boardId AND participant.id = :participantId AND participant.contactId IS NOT NULL',
        { boardId, participantId },
      )
      .getOne();
    if (!row) {
      throw new NotFoundException('Participant not found');
    }
    return row.contactId!;
  }
  async lockContact(manager: EntityManager, contactId: string) {
    await lockContactParents(manager, contactId);
    const contact = await manager
      .createQueryBuilder(ClientContactEntity, 'contact')
      .select('contact.clientId', 'clientId')
      .addSelect('client.archivedAt', 'archivedAt')
      .innerJoin(ClientEntity, 'client', 'client.id = contact.clientId')
      .where('contact.id = :contactId AND contact.removedAt IS NULL', { contactId })
      .getRawOne<Pick<ClientContactEntity, 'clientId'> & Pick<ClientEntity, 'archivedAt'>>();
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }
  async get(
    manager: EntityManager,
    boardId: string,
    participantId: string,
  ): Promise<ContactAssignment> {
    const row = await manager
      .createQueryBuilder(BoardParticipantEntity, 'participant')
      .where(
        'participant.boardId = :boardId AND participant.id = :participantId AND participant.contactId IS NOT NULL',
        { boardId, participantId },
      )
      .getOne();
    if (!row) {
      throw new NotFoundException('Participant not found');
    }
    return row as ContactAssignment;
  }
  async list(manager: EntityManager, boardId: string) {
    const rows = await manager
      .createQueryBuilder(BoardParticipantEntity, 'participant')
      .where('participant.boardId = :boardId AND participant.contactId IS NOT NULL', { boardId })
      .orderBy('participant.joinedAt')
      .addOrderBy('participant.id')
      .getMany();
    return rows.map((row) => participantResponse(row as ContactAssignment));
  }
  async assign(
    manager: EntityManager,
    boardId: string,
    clientId: string | null,
    userId: string,
    input: AssignContactRequest,
  ) {
    const contact = await this.lockContact(manager, input.contactId);
    if (contact.clientId !== clientId) {
      throw new NotFoundException('Contact not found');
    }
    if (contact.archivedAt) {
      throw new ConflictException('Client is archived');
    }
    validateExpiry(input.expiresAt);
    const old = (await manager
      .createQueryBuilder(BoardParticipantEntity, 'participant')
      .where('participant.boardId = :boardId AND participant.contactId = :contactId', {
        boardId,
        contactId: input.contactId,
      })
      .getOne()) as ContactAssignment | null;
    if (!old) {
      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(BoardParticipantEntity)
        .values({
          id: randomUUID(),
          boardId,
          contactId: input.contactId,
          role: input.role,
          invitedBy: userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        })
        .returning('*')
        .execute();
      return {
        row: entityFromRow(manager, BoardParticipantEntity, result.raw[0]) as ContactAssignment,
        created: true,
        restored: false,
        changedFields: [] as ('role' | 'expiresAt' | 'linkVersion')[],
      };
    }
    const restored =
      old.revokedAt !== null || (old.expiresAt !== null && old.expiresAt.getTime() <= Date.now());
    const expires =
      input.expiresAt === undefined && !restored
        ? (old.expiresAt?.toISOString() ?? null)
        : (input.expiresAt ?? null);
    const changedFields: ('role' | 'expiresAt' | 'linkVersion')[] = [];
    if (old.role !== input.role) {
      changedFields.push('role');
    }
    if ((old.expiresAt?.toISOString() ?? null) !== expires) {
      changedFields.push('expiresAt');
    }
    if (restored) {
      changedFields.push('linkVersion');
    }
    if (!changedFields.length) {
      return { row: old, created: false, restored, changedFields };
    }
    const result = await manager
      .createQueryBuilder()
      .update(BoardParticipantEntity)
      .set({
        role: input.role,
        expiresAt: expires ? new Date(expires) : null,
        revokedAt: null,
        revokedOnLeave: false,
        linkVersion: () => 'link_version + :generationChange',
      })
      .where('board_id = :boardId AND id = :id', { boardId, id: old.id })
      .setParameter('generationChange', restored ? 1 : 0)
      .returning('*')
      .execute();
    if (restored) {
      await this.deleteSessions(manager, old.id);
    }
    return {
      row: entityFromRow(manager, BoardParticipantEntity, result.raw[0]) as ContactAssignment,
      created: false,
      restored,
      changedFields,
    };
  }
  async update(
    manager: EntityManager,
    row: ContactAssignment,
    input: UpdateContactParticipantRequest,
  ) {
    validateExpiry(input.expiresAt);
    if (row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
      throw new ConflictException('Re-add participant to restore access');
    }
    const fields: ('role' | 'expiresAt')[] = [];
    if (input.role !== undefined && input.role !== row.role) {
      fields.push('role');
    }
    if (
      input.expiresAt !== undefined &&
      input.expiresAt !== (row.expiresAt?.toISOString() ?? null)
    ) {
      fields.push('expiresAt');
    }
    if (!fields.length) {
      return { row, fields };
    }
    const result = await manager
      .createQueryBuilder()
      .update(BoardParticipantEntity)
      .set({
        role: input.role ?? row.role,
        expiresAt:
          input.expiresAt === undefined
            ? row.expiresAt
            : input.expiresAt
              ? new Date(input.expiresAt)
              : null,
      })
      .where('id = :id', { id: row.id })
      .returning('*')
      .execute();
    return {
      row: entityFromRow(manager, BoardParticipantEntity, result.raw[0]) as ContactAssignment,
      fields,
    };
  }
  async revoke(manager: EntityManager, row: ContactAssignment): Promise<boolean> {
    if (row.revokedAt) {
      return false;
    }
    await manager
      .createQueryBuilder()
      .update(BoardParticipantEntity)
      .set({
        revokedAt: () => 'now()',
        revokedOnLeave: false,
        linkVersion: () => 'link_version + 1',
      })
      .where('id = :id', { id: row.id })
      .execute();
    await this.deleteSessions(manager, row.id);
    return true;
  }
  async rotate(manager: EntityManager, row: ContactAssignment): Promise<ContactAssignment> {
    const result = await manager
      .createQueryBuilder()
      .update(BoardParticipantEntity)
      .set({ linkVersion: () => 'link_version + 1' })
      .where('id = :id', { id: row.id })
      .returning('*')
      .execute();
    await this.deleteSessions(manager, row.id);
    return entityFromRow(manager, BoardParticipantEntity, result.raw[0]) as ContactAssignment;
  }
  async assertActive(manager: EntityManager, row: ContactAssignment) {
    const found = await manager
      .createQueryBuilder(BoardEntity, 'board')
      .innerJoin(ClientContactEntity, 'contact', 'contact.clientId = board.clientId')
      .where('board.id = :boardId AND contact.id = :contactId AND contact.removedAt IS NULL', {
        boardId: row.boardId,
        contactId: row.contactId,
      })
      .getExists();
    if (
      !found ||
      row.revokedAt ||
      !['viewer', 'approver'].includes(row.role) ||
      (row.expiresAt && row.expiresAt.getTime() <= Date.now())
    ) {
      throw new NotFoundException('Participant not found');
    }
  }
  private async deleteSessions(manager: EntityManager, participantId: string) {
    await manager
      .createQueryBuilder()
      .delete()
      .from(ContactSessionEntity)
      .where('participant_id = :participantId', { participantId })
      .execute();
  }
}
