import { Injectable } from '@nestjs/common';
import { BoardEvent, boardEventSchema } from '@moodboard/contracts';
import { appendBoardEvent, EntityManager } from '@moodboard/database';
@Injectable()
export class BoardEventWriter {
  append(
    manager: EntityManager,
    boardId: string,
    participantId: string | null,
    event: BoardEvent,
  ): Promise<string> {
    return appendBoardEvent(manager, boardId, participantId, boardEventSchema.parse(event));
  }
}
