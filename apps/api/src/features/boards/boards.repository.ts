import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateBoardRequest, UpdateBoardRequest } from '@moodboard/contracts';
import {
  BoardEntity,
  BoardParticipantEntity,
  WorkspaceMemberEntity,
  definedPatch,
} from '@moodboard/database';
import { EntityManager } from 'typeorm';
import { lockBusinessClient } from '../clients/clients.repository';

@Injectable()
export class BoardsRepository {
  async create(manager: EntityManager, userId: string, input: CreateBoardRequest) {
    if (input.clientId) {
      await lockBusinessClient(manager, userId, input.clientId, input.workspaceId);
    }
    const membership = await manager
      .createQueryBuilder(WorkspaceMemberEntity, 'member')
      .where('member.workspaceId = :workspaceId AND member.userId = :userId', {
        workspaceId: input.workspaceId,
        userId,
      })
      .setLock('for_key_share')
      .getOne();
    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }
    const boardId = randomUUID();
    const participantId = randomUUID();
    await manager
      .createQueryBuilder()
      .insert()
      .into(BoardEntity)
      .values({
        id: boardId,
        workspaceId: input.workspaceId,
        title: input.title,
        kitId: 'blank',
        layout: 'canvas',
        currency: input.currency ?? null,
        createdBy: userId,
        clientId: input.clientId ?? null,
      })
      .execute();
    await manager
      .createQueryBuilder()
      .insert()
      .into(BoardParticipantEntity)
      .values({ id: participantId, boardId, userId, role: 'owner' })
      .execute();
    return { boardId, participantId };
  }
  async update(manager: EntityManager, boardId: string, input: UpdateBoardRequest) {
    const patch = definedPatch(input, ['title', 'currency', 'clientId'] as const);
    if (!patch.changedFields.length) {
      return [];
    }
    await manager
      .createQueryBuilder()
      .update(BoardEntity)
      .set(patch.values)
      .where('id = :boardId', { boardId })
      .execute();
    return patch.changedFields;
  }
}
