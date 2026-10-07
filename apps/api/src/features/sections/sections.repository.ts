import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateSectionRequest, UpdateSectionRequest } from '@moodboard/contracts';
import { EntityManager } from 'typeorm';
import { ItemEntity, SectionEntity, definedPatch, entityFromRow } from '@moodboard/database';
import { sectionResponse } from './sections.mapper';

@Injectable()
export class SectionsRepository {
  async list(manager: EntityManager, boardId: string) {
    const sections = await manager
      .createQueryBuilder(SectionEntity, 'section')
      .where('section.boardId = :boardId', { boardId })
      .orderBy('section.position COLLATE "C"')
      .addOrderBy('section.id')
      .getMany();
    return sections.map(sectionResponse);
  }
  async create(manager: EntityManager, boardId: string, input: CreateSectionRequest) {
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(SectionEntity)
      .values({ id: randomUUID(), boardId, name: input.name, position: input.position })
      .returning('*')
      .execute();
    return sectionResponse(entityFromRow(manager, SectionEntity, result.raw[0]));
  }
  async update(
    manager: EntityManager,
    boardId: string,
    sectionId: string,
    input: UpdateSectionRequest,
  ) {
    const patch = definedPatch(input, ['name', 'position'] as const);
    const result = await manager
      .createQueryBuilder()
      .update(SectionEntity)
      .set(patch.values)
      .where('board_id = :boardId AND id = :sectionId', { boardId, sectionId })
      .returning('*')
      .execute();
    if (!result.raw[0]) {
      throw new NotFoundException('Section not found');
    }
    return {
      section: sectionResponse(entityFromRow(manager, SectionEntity, result.raw[0])),
      changedFields: patch.changedFields,
    };
  }
  async delete(manager: EntityManager, boardId: string, sectionId: string): Promise<void> {
    await this.assertOnBoard(manager, boardId, sectionId);
    await manager
      .createQueryBuilder()
      .update(ItemEntity)
      .set({ sectionId: null, updatedAt: () => 'now()' })
      .where('board_id = :boardId AND section_id = :sectionId', { boardId, sectionId })
      .execute();
    await manager
      .createQueryBuilder()
      .delete()
      .from(SectionEntity)
      .where('board_id = :boardId AND id = :sectionId', { boardId, sectionId })
      .execute();
  }
  async assertOnBoard(
    manager: EntityManager,
    boardId: string,
    sectionId: string | null | undefined,
  ): Promise<void> {
    if (sectionId === undefined || sectionId === null) {
      return;
    }
    const found = await manager
      .createQueryBuilder(SectionEntity, 'section')
      .where('section.boardId = :boardId AND section.id = :sectionId', { boardId, sectionId })
      .getExists();
    if (!found) {
      throw new NotFoundException('Section not found');
    }
  }
}
