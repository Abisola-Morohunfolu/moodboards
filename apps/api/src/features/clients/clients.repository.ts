import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ClientResponse, CreateContactRequest } from '@moodboard/contracts';
import {
  BoardEntity,
  BoardParticipantEntity,
  ClientEntity,
  ClientContactEntity,
  ContactSessionEntity,
  WorkspaceEntity,
  WorkspaceMemberEntity,
  entityFromRow,
} from '@moodboard/database';
import { lockContactParents } from '../access/contact-access';
import { clientResponse, contactResponse } from './clients.mapper';

export async function assertBusinessMember(
  manager: EntityManager,
  userId: string,
  workspaceId: string,
): Promise<void> {
  const row = await manager
    .createQueryBuilder(WorkspaceEntity, 'workspace')
    .select('workspace.type', 'type')
    .addSelect('member.role', 'role')
    .innerJoin(
      WorkspaceMemberEntity,
      'member',
      'member.workspaceId = workspace.id AND member.userId = :userId',
      { userId },
    )
    .where('workspace.id = :workspaceId', { workspaceId })
    .setLock('for_key_share', undefined, ['member'])
    .getRawOne<Pick<WorkspaceEntity, 'type'> & Pick<WorkspaceMemberEntity, 'role'>>();
  if (!row) {
    throw new NotFoundException('Workspace not found');
  }
  if (row.type !== 'business' || !['owner', 'staff'].includes(row.role)) {
    throw new ForbiddenException('Business workspace permission required');
  }
}
export async function lockBusinessClient(
  manager: EntityManager,
  userId: string,
  clientId: string,
  workspaceId?: string,
  active = true,
): Promise<ClientResponse> {
  const client = await manager
    .createQueryBuilder(ClientEntity, 'client')
    .where('client.id = :clientId', { clientId })
    .setLock('pessimistic_write')
    .getOne();
  if (!client || (workspaceId && client.workspaceId !== workspaceId)) {
    throw new NotFoundException('Client not found');
  }
  await assertBusinessMember(manager, userId, client.workspaceId);
  if (active && client.archivedAt) {
    throw new ConflictException('Client is archived');
  }
  return clientResponse(client);
}
@Injectable()
export class ClientsRepository {
  async list(manager: EntityManager, userId: string, workspaceId: string, archived: boolean) {
    await assertBusinessMember(manager, userId, workspaceId);
    const query = manager
      .createQueryBuilder(ClientEntity, 'client')
      .where('client.workspaceId = :workspaceId', { workspaceId });
    if (!archived) {
      query.andWhere('client.archivedAt IS NULL');
    }
    return (await query.orderBy('client.createdAt').addOrderBy('client.id').getMany()).map(
      clientResponse,
    );
  }
  async create(manager: EntityManager, userId: string, workspaceId: string, name: string) {
    await assertBusinessMember(manager, userId, workspaceId);
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ClientEntity)
      .values({ id: randomUUID(), workspaceId, name })
      .returning('*')
      .execute();
    return clientResponse(entityFromRow(manager, ClientEntity, result.raw[0]));
  }
  async archive(manager: EntityManager, userId: string, clientId: string) {
    await lockBusinessClient(manager, userId, clientId, undefined, false);
    await manager
      .createQueryBuilder()
      .update(ClientEntity)
      .set({ archivedAt: () => 'coalesce(archived_at, now())' })
      .where('id = :clientId', { clientId })
      .execute();
  }
  async contacts(manager: EntityManager, userId: string, clientId: string) {
    await lockBusinessClient(manager, userId, clientId, undefined, false);
    return (
      await manager
        .createQueryBuilder(ClientContactEntity, 'contact')
        .where('contact.clientId = :clientId AND contact.removedAt IS NULL', { clientId })
        .orderBy('contact.id')
        .getMany()
    ).map(contactResponse);
  }
  async createContact(
    manager: EntityManager,
    userId: string,
    clientId: string,
    input: CreateContactRequest,
  ) {
    await lockBusinessClient(manager, userId, clientId);
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ClientContactEntity)
      .values({ id: randomUUID(), clientId, name: input.name, email: input.email ?? null })
      .returning('*')
      .execute();
    return contactResponse(entityFromRow(manager, ClientContactEntity, result.raw[0]));
  }
  async contact(manager: EntityManager, userId: string, contactId: string) {
    await lockContactParents(manager, contactId);
    const contact = await manager
      .createQueryBuilder(ClientContactEntity, 'contact')
      .where('contact.id = :contactId', { contactId })
      .getOne();
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    await lockBusinessClient(manager, userId, contact.clientId, undefined, false);
    return contact;
  }
  lockAssignments(manager: EntityManager, contactId: string) {
    return manager
      .createQueryBuilder(BoardParticipantEntity, 'participant')
      .select('participant.id', 'id')
      .addSelect('participant.boardId', 'boardId')
      .innerJoin(BoardEntity, 'board', 'board.id = participant.boardId')
      .where('participant.contactId = :contactId', { contactId })
      .orderBy('board.id')
      .setLock('pessimistic_write', undefined, ['board'])
      .getRawMany<Pick<BoardParticipantEntity, 'id' | 'boardId'>>();
  }
  async anonymizeContact(manager: EntityManager, contactId: string) {
    await manager
      .createQueryBuilder()
      .update(ClientContactEntity)
      .set({
        name: '',
        email: null,
        removedAt: () => 'now()',
        linkVersion: () => 'link_version + 1',
      })
      .where('id = :contactId', { contactId })
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(ContactSessionEntity)
      .where('contact_id = :contactId', { contactId })
      .execute();
  }
  async revokeAssignment(manager: EntityManager, participantId: string) {
    await manager
      .createQueryBuilder()
      .update(BoardParticipantEntity)
      .set({
        revokedAt: () => 'coalesce(revoked_at, now())',
        revokedOnLeave: false,
        linkVersion: () => 'link_version + 1',
      })
      .where('id = :participantId', { participantId })
      .execute();
  }
}
