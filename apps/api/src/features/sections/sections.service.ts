import { Injectable } from '@nestjs/common';
import { CreateSectionRequest, UpdateSectionRequest } from '@moodboard/contracts';
import { AccessService } from '../access/access.service';
import { BoardEventWriter } from '../../platform/events/board-event.writer';
import { SectionsRepository } from './sections.repository';

@Injectable()
export class SectionsService {
  constructor(
    private readonly access: AccessService,
    private readonly repository: SectionsRepository,
    private readonly events: BoardEventWriter,
  ) {}
  create(userId: string, boardId: string, input: CreateSectionRequest) {
    return this.access.withBoard(userId, boardId, 'item.edit', async (manager, access) => {
      const section = await this.repository.create(manager, boardId, input);
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'section.created',
        payload: { sectionId: section.id },
      });
      return section;
    });
  }
  update(userId: string, boardId: string, sectionId: string, input: UpdateSectionRequest) {
    return this.access.withBoard(userId, boardId, 'item.edit', async (manager, access) => {
      const { section, changedFields } = await this.repository.update(
        manager,
        boardId,
        sectionId,
        input,
      );
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'section.updated',
        payload: { sectionId, changedFields },
      });
      return section;
    });
  }
  delete(userId: string, boardId: string, sectionId: string) {
    return this.access.withBoard(userId, boardId, 'item.edit', async (manager, access) => {
      await this.repository.delete(manager, boardId, sectionId);
      await this.events.append(manager, boardId, access.participantId!, {
        type: 'section.deleted',
        payload: { sectionId },
      });
    });
  }
}
