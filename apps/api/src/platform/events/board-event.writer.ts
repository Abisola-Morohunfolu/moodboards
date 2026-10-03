import { Injectable } from '@nestjs/common';
import { BoardCoreEvent, boardCoreEventSchema } from '@moodboard/contracts';
import { EntityManager } from 'typeorm';

@Injectable()
export class BoardEventWriter {
  async append(
    manager: EntityManager,
    boardId: string,
    participantId: string,
    event: BoardCoreEvent,
  ): Promise<string> {
    const validated = boardCoreEventSchema.parse(event);
    const rows: { event_seq: string }[] = await manager.query(
      'with advanced as (update boards set event_seq=event_seq+1 where id=$1 returning event_seq) select event_seq from advanced',
      [boardId],
    );
    if (!rows[0]) {
      throw new Error('Cannot append an event to a missing board');
    }
    const sequence = rows[0].event_seq;
    await manager.query(
      `insert into board_events (board_id, board_seq, participant_id, type, payload)
      values ($1,$2,$3,$4,$5::jsonb)`,
      [boardId, sequence, participantId, validated.type, JSON.stringify(validated.payload)],
    );
    return sequence;
  }
}
