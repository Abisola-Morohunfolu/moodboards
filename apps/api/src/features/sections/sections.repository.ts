import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateSectionRequest, UpdateSectionRequest, SectionResponse } from '@moodboard/contracts';
import { EntityManager } from 'typeorm';
import { patchColumns } from '../../database/patch-columns';

const sectionColumns = 'id, board_id as "boardId", name, position';
@Injectable()
export class SectionsRepository {
  list(manager: EntityManager, boardId: string): Promise<SectionResponse[]> {
    return manager.query(
      `select ${sectionColumns} from sections where board_id=$1 order by position collate "C", id`,
      [boardId],
    );
  }
  async create(
    manager: EntityManager,
    boardId: string,
    input: CreateSectionRequest,
  ): Promise<SectionResponse> {
    const rows: SectionResponse[] = await manager.query(
      `insert into sections (id, board_id, name, position)
      values ($1,$2,$3,$4) returning ${sectionColumns}`,
      [randomUUID(), boardId, input.name, input.position],
    );
    return rows[0]!;
  }
  async update(
    manager: EntityManager,
    boardId: string,
    sectionId: string,
    input: UpdateSectionRequest,
  ) {
    const patch = patchColumns(input, { name: 'name', position: 'position' }, 3);
    const rows: SectionResponse[] = await manager.query(
      `with updated as (update sections set ${patch.assignments}
      where board_id=$1 and id=$2 returning ${sectionColumns}) select * from updated`,
      [boardId, sectionId, ...patch.values],
    );
    if (!rows[0]) {
      throw new NotFoundException('Section not found');
    }
    return { section: rows[0], changedFields: patch.changedFields };
  }
  async delete(manager: EntityManager, boardId: string, sectionId: string): Promise<void> {
    await this.assertOnBoard(manager, boardId, sectionId);
    await manager.query(
      'update items set section_id=null, updated_at=now() where board_id=$1 and section_id=$2',
      [boardId, sectionId],
    );
    await manager.query('delete from sections where board_id=$1 and id=$2', [boardId, sectionId]);
  }
  async assertOnBoard(
    manager: EntityManager,
    boardId: string,
    sectionId: string | null | undefined,
  ): Promise<void> {
    if (sectionId === undefined || sectionId === null) {
      return;
    }
    const rows: unknown[] = await manager.query(
      'select 1 from sections where board_id=$1 and id=$2',
      [boardId, sectionId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Section not found');
    }
  }
}
