import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  WorkspaceEntity,
  WorkspaceMemberEntity,
  entityFromRow,
  withTransaction,
} from '@moodboard/database';
import { WorkspaceResponse } from '@moodboard/contracts';
import { workspaceResponse } from './workspaces.mapper';

@Injectable()
export class WorkspacesRepository {
  constructor(private readonly source: DataSource) {}
  async list(
    userId: string,
    manager: EntityManager = this.source.manager,
  ): Promise<WorkspaceResponse[]> {
    const rows = await manager
      .createQueryBuilder(WorkspaceEntity, 'workspace')
      .select('workspace.*')
      .addSelect('member.role', 'role')
      .innerJoin(WorkspaceMemberEntity, 'member', 'member.workspaceId = workspace.id')
      .where('member.userId = :userId', { userId })
      .orderBy('workspace.createdAt')
      .addOrderBy('workspace.id')
      .getRawMany<Record<string, unknown> & Pick<WorkspaceMemberEntity, 'role'>>();
    return rows.map((row) =>
      workspaceResponse(entityFromRow(manager, WorkspaceEntity, row), row.role),
    );
  }
  async create(userId: string, name: string): Promise<WorkspaceResponse> {
    return withTransaction(this.source, async (manager) => {
      const id = randomUUID();
      await manager
        .createQueryBuilder()
        .insert()
        .into(WorkspaceEntity)
        .values({ id, type: 'business', name })
        .execute();
      await manager
        .createQueryBuilder()
        .insert()
        .into(WorkspaceMemberEntity)
        .values({ workspaceId: id, userId, role: 'owner' })
        .execute();
      return (await this.list(userId, manager)).find((workspace) => workspace.id === id)!;
    });
  }
}
