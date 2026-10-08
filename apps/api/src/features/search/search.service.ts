import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceSearchQuery, WorkspaceSearchResponse } from '@moodboard/contracts';
import { ItemEntity, SectionEntity } from '@moodboard/database';
import { DataSource } from 'typeorm';
import { AccessRepository } from '../access/access.repository';
import { ItemsRepository } from '../items/items.repository';
import { decodeCursor, encodeCursor, PageCursor } from '../../platform/pagination';

@Injectable()
export class SearchService {
  constructor(
    private readonly source: DataSource,
    private readonly access: AccessRepository,
    private readonly items: ItemsRepository,
  ) {}

  async find(
    userId: string,
    workspaceId: string,
    input: WorkspaceSearchQuery,
  ): Promise<WorkspaceSearchResponse> {
    const scope = createHash('sha256')
      .update(
        JSON.stringify([
          workspaceId.toLowerCase(),
          input.q.toLowerCase(),
          input.boardId ?? null,
          input.kind ?? null,
        ]),
      )
      .digest('hex');
    const cursor = decodeCursor(input.cursor, scope);
    const pattern = `%${input.q.replace(/[!%_]/g, '!$&')}%`;
    // Access and matching use the same snapshot; search never creates participant rows.
    return this.source.transaction('REPEATABLE READ', async (manager) => {
      const boards = await this.access.list(manager, userId, workspaceId);
      const byId = new Map(boards.map((board) => [board.id, board]));
      if (input.boardId && !byId.has(input.boardId)) {
        throw new NotFoundException('Board not found');
      }
      const ids = input.boardId ? [input.boardId] : boards.map((board) => board.id);
      if (!ids.length) {
        return { results: [], nextCursor: null };
      }
      const rows = await manager.sql<Omit<PageCursor, 'scope'>[]>`
        WITH matches AS (
          SELECT 'board'::text AS type, b.id, b.created_at AS time
          FROM boards b
          WHERE b.id = ANY(${ids}::uuid[]) AND ${input.kind ?? null}::text IS NULL
            AND b.title ILIKE ${pattern} ESCAPE '!'
          UNION ALL
          SELECT 'item'::text AS type, i.id, i.created_at AS time
          FROM items i LEFT JOIN link_previews p ON p.id = i.link_preview_id
          WHERE i.board_id = ANY(${ids}::uuid[]) AND i.deleted_at IS NULL
            AND (${input.kind ?? null}::text IS NULL OR i.kind::text = ${input.kind ?? null})
            AND (i.title ILIKE ${pattern} ESCAPE '!' OR i.note ILIKE ${pattern} ESCAPE '!'
              OR p.url ILIKE ${pattern} ESCAPE '!' OR p.title ILIKE ${pattern} ESCAPE '!'
              OR p.description ILIKE ${pattern} ESCAPE '!' OR p.site_name ILIKE ${pattern} ESCAPE '!')
        )
        SELECT type, id, to_char(time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS time
        FROM matches
        WHERE ${cursor?.type ?? null}::text IS NULL
          OR (CASE WHEN type = 'board' THEN 0 ELSE 1 END) > ${cursor?.type === 'item' ? 1 : 0}
          OR (type = ${cursor?.type ?? null} AND (time < ${cursor?.time ?? null}::timestamptz
            OR (time = ${cursor?.time ?? null}::timestamptz AND id > ${cursor?.id ?? null}::uuid)))
        ORDER BY CASE WHEN type = 'board' THEN 0 ELSE 1 END, time DESC, id ASC
        LIMIT 21
      `;
      const page = rows.slice(0, 20);
      const itemIds = page.filter((row) => row.type === 'item').map((row) => row.id);
      const entities = itemIds.length
        ? await manager
            .createQueryBuilder(ItemEntity, 'item')
            .where('item.id IN (:...itemIds)', { itemIds })
            .getMany()
        : [];
      const responses = await this.items.responses(manager, entities, 'viewer', 'owner', (item) =>
        byId.get(item.boardId)!,
      );
      const itemsById = new Map(responses.map((item) => [item.id, item]));
      const sectionIds = [
        ...new Set(entities.flatMap((item) => (item.sectionId ? [item.sectionId] : []))),
      ];
      const sections = sectionIds.length
        ? await manager
            .createQueryBuilder(SectionEntity, 'section')
            .where('section.id IN (:...sectionIds)', { sectionIds })
            .getMany()
        : [];
      const sectionsById = new Map(sections.map((section) => [section.id, section]));
      return {
        results: page.map((row) => {
          if (row.type === 'board') {
            return { type: 'board' as const, board: byId.get(row.id)! };
          }
          const item = itemsById.get(row.id)!;
          return {
            type: 'item' as const,
            board: byId.get(item.boardId)!,
            item,
            section: item.sectionId ? sectionsById.get(item.sectionId)! : null,
          };
        }),
        nextCursor: rows.length > 20 ? encodeCursor({ ...page.at(-1)!, scope }) : null,
      };
    });
  }
}
