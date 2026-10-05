import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { withTransaction } from '@moodboard/database';
import { AccessRepository, BoardAccess } from './access.repository';
import { BoardPermission, hasBoardPermission } from './board-role';

@Injectable()
export class AccessService {
  constructor(
    private readonly source: DataSource,
    private readonly repository: AccessRepository,
  ) {}
  withBoard<T>(
    userId: string,
    boardId: string,
    permission: BoardPermission,
    work: (manager: EntityManager, access: BoardAccess) => Promise<T>,
    ensureActor = true,
    beforeLock?: (manager: EntityManager) => Promise<void>,
  ): Promise<T> {
    return withTransaction(this.source, async (manager) => {
      if (beforeLock) {
        await beforeLock(manager);
      }
      const access = await this.repository.load(manager, userId, boardId, true);
      if (!hasBoardPermission(access.role, permission)) {
        throw new ForbiddenException('Board permission required');
      }
      if (ensureActor && access.participantId === null) {
        access.participantId = await this.repository.ensureParticipant(manager, userId, boardId);
      }
      return work(manager, access);
    });
  }
  list(userId: string, workspaceId?: string) {
    return this.repository.list(this.source.manager, userId, workspaceId);
  }
}
