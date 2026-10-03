import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateNoteRequest, MoveNoteRequest, UpdateNoteRequest } from '@moodboard/contracts';
import { AccessService } from '../access/access.service';
import { SectionsRepository } from '../sections/sections.repository';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { ItemsRepository, noteResponse } from './items.repository';

@Injectable()
export class ItemsService {
  constructor(
    private readonly access: AccessService,
    private readonly repository: ItemsRepository,
    private readonly sections: SectionsRepository,
    private readonly events: BoardEventWriter,
  ) {}
  list(userId: string, boardId: string) {
    return this.access.withBoard(
      userId,
      boardId,
      'board.view',
      async (manager, access) => {
        const items = await this.repository.list(manager, boardId);
        return items.map((item) => noteResponse(item, access.role, access.board.show_prices_to));
      },
      false,
    );
  }
  create(userId: string, boardId: string, input: CreateNoteRequest) {
    return this.access.withBoard(userId, boardId, 'item.create', async (manager, access) => {
      // A retry ignores changed input, including a section that has since been deleted.
      const existing = await this.repository.existing(manager, boardId, input.id);
      if (existing) {
        return {
          item: noteResponse(existing, access.role, access.board.show_prices_to),
          created: false,
        };
      }
      await this.sections.assertOnBoard(manager, boardId, input.sectionId);
      const { item, created } = await this.repository.create(
        manager,
        boardId,
        access.participantId!,
        input,
      );
      if (created) {
        await this.events.append(manager, boardId, access.participantId!, {
          type: 'item.created',
          payload: { itemId: item.id, kind: 'note', version: item.version },
        });
      }
      return { item: noteResponse(item, access.role, access.board.show_prices_to), created };
    });
  }
  async update(userId: string, itemId: string, input: UpdateNoteRequest) {
    const boardId = await this.repository.boardId(itemId);
    return this.access.withBoard(userId, boardId, 'item.edit', async (manager, access) => {
      const current = await this.repository.get(manager, boardId, itemId);
      if (current.deleted_at !== null) {
        throw new NotFoundException('Item not found');
      }
      const { item, changedFields } = await this.repository.update(manager, boardId, itemId, input);
      if (item === null) {
        throw new ConflictException({
          statusCode: 409,
          message: 'Item version conflict',
          currentItem: noteResponse(current, access.role, access.board.show_prices_to),
        });
      }
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'item.updated',
        payload: { itemId, version: item.version, changedFields },
      });
      return noteResponse(item, access.role, access.board.show_prices_to);
    });
  }
  async move(userId: string, itemId: string, input: MoveNoteRequest) {
    const boardId = await this.repository.boardId(itemId);
    return this.access.withBoard(userId, boardId, 'item.move', async (manager, access) => {
      const current = await this.repository.get(manager, boardId, itemId);
      if (current.deleted_at !== null) {
        throw new NotFoundException('Item not found');
      }
      await this.sections.assertOnBoard(manager, boardId, input.sectionId);
      const { item, changedFields } = await this.repository.move(manager, boardId, itemId, input);
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'item.moved',
        payload: { itemId, changedFields },
      });
      return noteResponse(item, access.role, access.board.show_prices_to);
    });
  }
  async delete(userId: string, itemId: string) {
    const boardId = await this.repository.boardId(itemId);
    return this.access.withBoard(userId, boardId, 'item.delete', async (manager, access) => {
      await this.repository.get(manager, boardId, itemId);
      if (await this.repository.delete(manager, boardId, itemId)) {
        await this.events.append(manager, boardId, access.participantId!, {
          type: 'item.deleted',
          payload: { itemId },
        });
      }
    });
  }
}
