import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateBoardRequest, UpdateBoardRequest } from '@moodboard/contracts';
import { EntityManager } from 'typeorm';
import { patchColumns } from '../../database/patch-columns';

@Injectable()
export class BoardsRepository {
  async create(manager: EntityManager, userId: string, input: CreateBoardRequest) {
    const membership: unknown[] = await manager.query(
      `select m.role from workspace_members m
      where m.workspace_id=$1 and m.user_id=$2 for key share`,
      [input.workspaceId, userId],
    );
    if (membership.length === 0) {
      throw new NotFoundException('Workspace not found');
    }
    const boardId = randomUUID();
    const participantId = randomUUID();
    await manager.query(
      `insert into boards (id, workspace_id, title, kit_id, layout, currency, created_by)
      values ($1,$2,$3,'blank','canvas',$4,$5)`,
      [boardId, input.workspaceId, input.title, input.currency ?? null, userId],
    );
    await manager.query(
      `insert into board_participants (id, board_id, user_id, role)
      values ($1,$2,$3,'owner')`,
      [participantId, boardId, userId],
    );
    return { boardId, participantId };
  }
  async update(manager: EntityManager, boardId: string, input: UpdateBoardRequest) {
    const patch = patchColumns(input, { title: 'title', currency: 'currency' });
    await manager.query(`update boards set ${patch.assignments} where id=$1`, [
      boardId,
      ...patch.values,
    ]);
    return patch.changedFields;
  }
}
