import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { withTransaction } from '@moodboard/database';
import { WorkspaceResponse } from '@moodboard/contracts';

@Injectable()
export class WorkspacesRepository {
  constructor(private readonly source: DataSource) {}
  list(userId: string, manager: EntityManager = this.source.manager): Promise<WorkspaceResponse[]> {
    return manager.query(
      `select w.id, w.type, w.name, w.logo_key as "logoKey",
      w.brand_colour as "brandColour", to_char(w.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt", m.role
      from workspaces w join workspace_members m on m.workspace_id=w.id
      where m.user_id=$1 order by w.created_at, w.id`,
      [userId],
    );
  }
  async create(userId: string, name: string): Promise<WorkspaceResponse> {
    return withTransaction(this.source, async (manager) => {
      const id = randomUUID();
      await manager.query("insert into workspaces (id, type, name) values ($1, 'business', $2)", [
        id,
        name,
      ]);
      await manager.query(
        "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
        [id, userId],
      );
      return (await this.list(userId, manager)).find((workspace) => workspace.id === id)!;
    });
  }
}
