import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import {
  CreateBoardRequest,
  UpdateBoardRequest,
  BoardDetailResponse,
  BoardWithRoleResponse,
} from '@moodboard/contracts';
import { withTransaction } from '@moodboard/database';
import { DataSource } from 'typeorm';
import { AccessService } from '../access/access.service';
import { AccessRepository } from '../access/access.repository';
import { boardResponse } from '../access/access.mapper';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { SectionsRepository } from '../sections/sections.repository';
import { BoardsRepository } from './boards.repository';
import { BoardPrincipal } from '../access/contact-access';
import { lockBusinessClient } from '../clients/clients.repository';

@Injectable()
export class BoardsService {
  constructor(
    private readonly source: DataSource,
    private readonly repository: BoardsRepository,
    private readonly access: AccessService,
    private readonly accessRepository: AccessRepository,
    private readonly events: BoardEventWriter,
    private readonly sections: SectionsRepository,
  ) {}
  create(userId: string, input: CreateBoardRequest): Promise<BoardWithRoleResponse> {
    return withTransaction(this.source, async (manager) => {
      const { boardId, participantId } = await this.repository.create(manager, userId, input);
      await this.events.append(manager, boardId, participantId, {
        type: 'board.created',
        payload: { boardId },
      });
      const access = await this.accessRepository.load(manager, userId, boardId);
      return { ...boardResponse(access.board), role: access.role };
    });
  }
  list(userId: string, workspaceId?: string) {
    return this.access.list(userId, workspaceId);
  }
  get(userId: BoardPrincipal, boardId: string): Promise<BoardDetailResponse> {
    return this.access.withBoard(
      userId,
      boardId,
      'board.view',
      async (manager, access) => ({
        board: boardResponse(access.board),
        sections: await this.sections.list(manager, boardId),
        modules: [],
        role: access.role,
      }),
      typeof userId === 'string',
    );
  }
  update(
    userId: string,
    boardId: string,
    input: UpdateBoardRequest,
  ): Promise<BoardWithRoleResponse> {
    return this.access.withBoard(
      userId,
      boardId,
      'board.share',
      async (manager, access) => {
        const patch = { ...input };
        if (patch.clientId !== undefined) {
          if (access.board.clientId && patch.clientId !== access.board.clientId) {
            throw new ConflictException('Board client cannot be changed');
          }
          if (patch.clientId === access.board.clientId) {
            delete patch.clientId;
          } else if (patch.clientId) {
            const client = await lockBusinessClient(
              manager,
              userId,
              patch.clientId,
              access.board.workspaceId,
            );
            if (client.workspaceId !== access.board.workspaceId) {
              throw new NotFoundException('Client not found');
            }
          }
        }
        const changedFields = await this.repository.update(manager, boardId, patch);
        if (changedFields.length) {
          await this.events.append(manager, boardId, access.participantId!, {
            type: 'board.updated',
            payload: { boardId, changedFields },
          });
        }
        const updated = await this.accessRepository.load(manager, userId, boardId);
        return { ...boardResponse(updated.board), role: updated.role };
      },
      true,
      input.clientId
        ? async (manager) => {
            await lockBusinessClient(manager, userId, input.clientId!, undefined, false);
          }
        : undefined,
    );
  }
}
