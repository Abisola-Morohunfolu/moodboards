import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { BoardResponse, BoardRole } from '@moodboard/contracts';
import { EntityManager } from 'typeorm';
import { resolveAccountBoardRole } from './board-role';
import { ContactPrincipal, lockContactParents, assertContactSession } from './contact-access';

export interface BoardRecord {
  id: string;
  workspace_id: string;
  client_id: string | null;
  kit_id: string;
  title: string;
  layout: 'canvas' | 'grid';
  currency: string | null;
  general_access: 'restricted' | 'workspace' | 'link';
  workspace_default_role: BoardRole;
  show_prices_to: BoardRole;
  event_seq: string;
  locked_at: Date | null;
  archived_at: Date | null;
  created_by: string;
  created_at: Date;
  workspace_type: 'personal' | 'business';
  workspace_role: 'owner' | 'staff' | 'partner' | null;
  participant_id: string | null;
  participant_role: BoardRole | null;
  participant_revoked_at: Date | null;
  participant_expires_at: Date | null;
}
export interface BoardAccess {
  board: BoardRecord;
  role: BoardRole;
  participantId: string | null;
}
const accessQuery = `select b.*, w.type as workspace_type, m.role as workspace_role,
  p.id as participant_id, p.role as participant_role,
  p.revoked_at as participant_revoked_at, p.expires_at as participant_expires_at
  from boards b join workspaces w on w.id=b.workspace_id
  left join workspace_members m on m.workspace_id=b.workspace_id and m.user_id=$1
  left join board_participants p on p.board_id=b.id and p.user_id=$1`;

export function accountRole(board: BoardRecord): BoardRole | null {
  return resolveAccountBoardRole({
    workspaceType: board.workspace_type,
    workspaceRole: board.workspace_role,
    generalAccess: board.general_access,
    workspaceDefaultRole: board.workspace_default_role,
    participant:
      board.participant_id === null
        ? null
        : {
            role: board.participant_role,
            revokedAt: board.participant_revoked_at,
            expiresAt: board.participant_expires_at,
          },
    lockedAt: board.locked_at,
    archivedAt: board.archived_at,
  });
}
export function boardResponse(board: BoardRecord): BoardResponse {
  return {
    id: board.id,
    workspaceId: board.workspace_id,
    clientId: board.client_id,
    kitId: board.kit_id,
    title: board.title,
    layout: board.layout,
    currency: board.currency,
    generalAccess: board.general_access,
    workspaceDefaultRole: board.workspace_default_role,
    showPricesTo: board.show_prices_to,
    eventSeq: board.event_seq,
    lockedAt: board.locked_at?.toISOString() ?? null,
    archivedAt: board.archived_at?.toISOString() ?? null,
    createdBy: board.created_by,
    createdAt: board.created_at.toISOString(),
  };
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
    await manager.query('select id from boards where id=$1 for update', [boardId]);
    await assertContactSession(manager, principal);
    const [board] = await manager.query<BoardRecord[]>(
      `select b.*, w.type as workspace_type,
      null as workspace_role, p.id as participant_id, p.role as participant_role,
      p.revoked_at as participant_revoked_at, p.expires_at as participant_expires_at
      from boards b join workspaces w on w.id=b.workspace_id
      join board_participants p on p.board_id=b.id where b.id=$1 and p.id=$2`,
      [boardId, principal.participantId],
    );
    if (!board) {
      throw new NotFoundException('Board not found');
    }
    const role =
      board.locked_at || board.archived_at || board.participant_role === 'viewer'
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
      await manager.query('select id from boards where id=$1 for update', [boardId]);
    }
    const rows: BoardRecord[] = await manager.query(`${accessQuery} where b.id=$2`, [
      userId,
      boardId,
    ]);
    const board = rows[0];
    const role = board ? accountRole(board) : null;
    if (!board || !role) {
      throw new NotFoundException('Board not found');
    }
    return { board, role, participantId: board.participant_id };
  }
  async list(manager: EntityManager, userId: string, workspaceId?: string) {
    if (workspaceId !== undefined) {
      const members: unknown[] = await manager.query(
        'select 1 from workspace_members where workspace_id=$1 and user_id=$2',
        [workspaceId, userId],
      );
      if (members.length === 0) {
        throw new NotFoundException('Workspace not found');
      }
    }
    const rows: BoardRecord[] = await manager.query(
      `${accessQuery}
      where ${workspaceId === undefined ? 'p.id is not null' : 'b.workspace_id=$2 and m.user_id is not null'}
      order by b.created_at, b.id`,
      workspaceId === undefined ? [userId] : [userId, workspaceId],
    );
    return rows.flatMap((board) => {
      const role = accountRole(board);
      return role === null ? [] : [{ ...boardResponse(board), role }];
    });
  }
  async ensureParticipant(
    manager: EntityManager,
    userId: string,
    boardId: string,
  ): Promise<string> {
    const inserted: { id: string }[] = await manager.query(
      `insert into board_participants (id, board_id, user_id)
      values ($1,$2,$3) on conflict (board_id, user_id) where user_id is not null do nothing returning id`,
      [randomUUID(), boardId, userId],
    );
    if (inserted[0]) {
      return inserted[0].id;
    }
    const existing: { id: string }[] = await manager.query(
      'select id from board_participants where board_id=$1 and user_id=$2',
      [boardId, userId],
    );
    return existing[0]!.id;
  }
}
