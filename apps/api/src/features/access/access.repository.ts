import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { BoardRole } from '@moodboard/contracts';
import {
  BoardEntity,
  BoardParticipantEntity,
  WorkspaceEntity,
  WorkspaceMemberEntity,
  entityFromRow,
} from '@moodboard/database';
import { EntityManager, SelectQueryBuilder } from 'typeorm';
import { resolveAccountBoardRole } from './board-role';
import { ContactPrincipal, lockContactParents, assertContactSession } from './contact-access';
import { boardResponse } from './access.mapper';

interface AccessProjection {
  workspaceType: WorkspaceEntity['type'];
  workspaceRole: WorkspaceMemberEntity['role'] | null;
  participantId: string | null;
  participantRole: BoardRole | null;
  participantRevokedAt: Date | null;
  participantExpiresAt: Date | null;
}
export type BoardRecord = BoardEntity & AccessProjection;
export interface BoardAccess {
  board: BoardRecord;
  role: BoardRole;
  participantId: string | null;
}
function accessProjection(query: SelectQueryBuilder<BoardEntity>) {
  return query
    .select('board.*')
    .addSelect('workspace.type', 'workspaceType')
    .addSelect('participant.id', 'participantId')
    .addSelect('participant.role', 'participantRole')
    .addSelect('participant.revokedAt', 'participantRevokedAt')
    .addSelect('participant.expiresAt', 'participantExpiresAt');
}
function accountQuery(manager: EntityManager, userId: string) {
  return accessProjection(
    manager
      .createQueryBuilder(BoardEntity, 'board')
      .innerJoin(WorkspaceEntity, 'workspace', 'workspace.id = board.workspaceId')
      .leftJoin(
        WorkspaceMemberEntity,
        'member',
        'member.workspaceId = board.workspaceId AND member.userId = :userId',
        { userId },
      )
      .leftJoin(
        BoardParticipantEntity,
        'participant',
        'participant.boardId = board.id AND participant.userId = :userId',
        { userId },
      ),
  ).addSelect('member.role', 'workspaceRole');
}
function accessRecord(
  manager: EntityManager,
  row: Record<string, unknown> & AccessProjection,
): BoardRecord {
  return {
    ...entityFromRow(manager, BoardEntity, row),
    workspaceType: row.workspaceType,
    workspaceRole: row.workspaceRole,
    participantId: row.participantId,
    participantRole: row.participantRole,
    participantRevokedAt: row.participantRevokedAt,
    participantExpiresAt: row.participantExpiresAt,
  };
}
export function accountRole(board: BoardRecord): BoardRole | null {
  return resolveAccountBoardRole({
    workspaceType: board.workspaceType,
    workspaceRole: board.workspaceRole,
    generalAccess: board.generalAccess,
    workspaceDefaultRole: board.workspaceDefaultRole,
    participant:
      board.participantId === null
        ? null
        : {
            role: board.participantRole,
            revokedAt: board.participantRevokedAt,
            expiresAt: board.participantExpiresAt,
          },
    lockedAt: board.lockedAt,
    archivedAt: board.archivedAt,
  });
}

@Injectable()
export class AccessRepository {
  async loadContact(
    manager: EntityManager,
    principal: ContactPrincipal,
    boardId: string,
  ): Promise<BoardAccess> {
    if (boardId.toLowerCase() !== principal.boardId) {
      throw new NotFoundException('Board not found');
    }
    await lockContactParents(manager, principal.contactId);
    await this.lockBoard(manager, boardId);
    await assertContactSession(manager, principal);
    const row = await accessProjection(
      manager
        .createQueryBuilder(BoardEntity, 'board')
        .innerJoin(WorkspaceEntity, 'workspace', 'workspace.id = board.workspaceId')
        .innerJoin(BoardParticipantEntity, 'participant', 'participant.boardId = board.id'),
    )
      .addSelect('NULL', 'workspaceRole')
      .where('board.id = :boardId AND participant.id = :participantId', {
        boardId,
        participantId: principal.participantId,
      })
      .getRawOne<Record<string, unknown> & AccessProjection>();
    if (!row) {
      throw new NotFoundException('Board not found');
    }
    const board = accessRecord(manager, row);
    const role =
      board.lockedAt || board.archivedAt || board.participantRole === 'viewer'
        ? 'viewer'
        : 'approver';
    return { board, role, participantId: principal.participantId };
  }
  async load(
    manager: EntityManager,
    userId: string,
    boardId: string,
    lock = false,
  ): Promise<BoardAccess> {
    if (lock) {
      await this.lockBoard(manager, boardId);
    }
    const row = await accountQuery(manager, userId)
      .where('board.id = :boardId', { boardId })
      .getRawOne<Record<string, unknown> & AccessProjection>();
    const board = row ? accessRecord(manager, row) : null;
    const role = board ? accountRole(board) : null;
    if (!board || !role) {
      throw new NotFoundException('Board not found');
    }
    return { board, role, participantId: board.participantId };
  }
  async list(manager: EntityManager, userId: string, workspaceId?: string) {
    if (workspaceId !== undefined) {
      const member = await manager
        .createQueryBuilder(WorkspaceMemberEntity, 'member')
        .where('member.workspaceId = :workspaceId AND member.userId = :userId', {
          workspaceId,
          userId,
        })
        .getExists();
      if (!member) {
        throw new NotFoundException('Workspace not found');
      }
    }
    const query = accountQuery(manager, userId);
    if (workspaceId === undefined) {
      query.where('participant.id IS NOT NULL');
    } else {
      query.where('board.workspaceId = :workspaceId AND member.userId IS NOT NULL', {
        workspaceId,
      });
    }
    const rows = await query
      .orderBy('board.createdAt')
      .addOrderBy('board.id')
      .getRawMany<Record<string, unknown> & AccessProjection>();
    return rows.flatMap((row) => {
      const board = accessRecord(manager, row);
      const role = accountRole(board);
      return role === null ? [] : [{ ...boardResponse(board), role }];
    });
  }
  async ensureParticipant(
    manager: EntityManager,
    userId: string,
    boardId: string,
  ): Promise<string> {
    // Preserve the partial-index conflict target: unrelated identity constraints
    // must still fail instead of being silently ignored.
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(BoardParticipantEntity)
      .values({ id: randomUUID(), boardId, userId })
      .onConflict('(board_id, user_id) WHERE user_id IS NOT NULL DO NOTHING')
      .returning(['id'])
      .execute();
    if (result.raw[0]) {
      return result.raw[0].id;
    }
    const existing = await manager
      .createQueryBuilder(BoardParticipantEntity, 'participant')
      .select(['participant.id'])
      .where('participant.boardId = :boardId AND participant.userId = :userId', { boardId, userId })
      .getOne();
    return existing!.id;
  }
  private async lockBoard(manager: EntityManager, boardId: string) {
    await manager
      .createQueryBuilder(BoardEntity, 'board')
      .select(['board.id'])
      .where('board.id = :boardId', { boardId })
      .setLock('pessimistic_write')
      .getOne();
  }
}
