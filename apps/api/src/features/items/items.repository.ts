import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BoardRole,
  CreateItemRequest,
  ItemResponse,
  MoveNoteRequest,
  NoteResponse,
  UpdateNoteRequest,
} from '@moodboard/contracts';
import { DataSource, EntityManager } from 'typeorm';
import { patchColumns } from '../../database/patch-columns';
import { roleRank } from '../access/board-role';

export interface ItemRow {
  id: string;
  board_id: string;
  section_id: string | null;
  created_by: string;
  kind: 'note' | 'image' | 'link';
  asset_id: string | null;
  link_preview_id: string | null;
  title: string | null;
  note: string | null;
  x: number | null;
  y: number | null;
  z_order: string;
  price_cents: number | null;
  quantity: number;
  version: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const itemColumns = `id, board_id, section_id, created_by, kind, asset_id, link_preview_id,
  title, note, x, y, z_order, price_cents, quantity, version,
  deleted_at, created_at, updated_at`;

type AssetMetadata = Extract<ItemResponse, { kind: 'image' }>['asset'];
type PreviewMetadata = Omit<
  Extract<ItemResponse, { kind: 'link' }>['preview'],
  'fetchedAt' | 'expiresAt'
> & { fetchedAt: Date | null; expiresAt: Date | null };
export function noteResponse(
  item: ItemRow,
  role: BoardRole,
  showPricesTo: BoardRole,
): NoteResponse {
  return {
    id: item.id,
    boardId: item.board_id,
    sectionId: item.section_id,
    createdBy: item.created_by,
    kind: 'note',
    title: item.title,
    note: item.note,
    x: item.x,
    y: item.y,
    zOrder: item.z_order,
    ...(roleRank[role] >= roleRank[showPricesTo] ? { priceCents: item.price_cents } : {}),
    quantity: item.quantity,
    version: item.version,
    deletedAt: item.deleted_at?.toISOString() ?? null,
    createdAt: item.created_at.toISOString(),
    updatedAt: item.updated_at.toISOString(),
  };
}

@Injectable()
export class ItemsRepository {
  constructor(private readonly source: DataSource) {}
  async boardId(itemId: string): Promise<string> {
    const rows = await this.source.manager.sql<{ board_id: string }[]>`
      SELECT board_id
      FROM items
      WHERE id = ${itemId}
    `;
    if (!rows[0]) {
      throw new NotFoundException('Item not found');
    }
    return rows[0].board_id;
  }
  list(manager: EntityManager, boardId: string): Promise<ItemRow[]> {
    return manager.sql<ItemRow[]>`
      SELECT ${() => itemColumns}
      FROM items
      WHERE board_id = ${boardId} AND deleted_at IS NULL
      ORDER BY z_order COLLATE "C", id
    `;
  }
  async get(manager: EntityManager, boardId: string, itemId: string): Promise<ItemRow> {
    const rows = await manager.sql<ItemRow[]>`
      SELECT ${() => itemColumns}
      FROM items
      WHERE board_id = ${boardId} AND id = ${itemId}
    `;
    if (!rows[0]) {
      throw new NotFoundException('Item not found');
    }
    return rows[0];
  }
  async existing(manager: EntityManager, boardId: string, itemId: string): Promise<ItemRow | null> {
    const rows = await manager.sql<ItemRow[]>`
      SELECT ${() => itemColumns}
      FROM items
      WHERE id = ${itemId}
    `;
    const item = rows[0];
    if (!item) {
      return null;
    }
    if (item.board_id !== boardId.toLowerCase()) {
      throw new ConflictException('Item id already in use');
    }
    return item;
  }
  async create(
    manager: EntityManager,
    boardId: string,
    participantId: string,
    input: CreateItemRequest,
    previewId: string | null = null,
  ) {
    const rows = await manager.sql<ItemRow[]>`
      INSERT INTO items (
        id, board_id, section_id, created_by, kind,
        title, note, x, y, z_order, price_cents, quantity,
        asset_id, link_preview_id
      )
      VALUES (
        ${input.id}, ${boardId}, ${input.sectionId ?? null}, ${participantId}, ${input.kind},
        ${input.title ?? null}, ${input.note ?? null}, ${input.x ?? 0}, ${input.y ?? 0},
        ${input.zOrder}, ${input.priceCents ?? null}, ${input.quantity ?? 1},
        ${input.kind === 'image' ? input.assetId : null}, ${previewId}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING ${() => itemColumns}
    `;
    if (rows[0]) {
      return { item: rows[0], created: true };
    }
    return { item: (await this.existing(manager, boardId, input.id))!, created: false };
  }
  async response(
    manager: EntityManager,
    item: ItemRow,
    role: BoardRole,
    showPricesTo: BoardRole,
  ): Promise<ItemResponse> {
    return (await this.responses(manager, [item], role, showPricesTo))[0]!;
  }
  async responses(
    manager: EntityManager,
    items: ItemRow[],
    role: BoardRole,
    showPricesTo: BoardRole,
  ): Promise<ItemResponse[]> {
    const assetIds = [
      ...new Set(items.flatMap((item) => (item.kind === 'image' ? [item.asset_id] : []))),
    ];
    const previewIds = [
      ...new Set(items.flatMap((item) => (item.kind === 'link' ? [item.link_preview_id] : []))),
    ];
    const assets = assetIds.length
      ? await manager.sql<(AssetMetadata & { board_id: string })[]>`
          SELECT id, board_id, status, mime_type AS mime, bytes, width, height, palette
          FROM assets
          WHERE id = ANY(${assetIds}::uuid[])
        `
      : [];
    const previews = previewIds.length
      ? await manager.sql<PreviewMetadata[]>`
          SELECT id, url, status, title, description,
            image_url AS "imageUrl", site_name AS "siteName",
            fetched_at AS "fetchedAt", expires_at AS "expiresAt"
          FROM link_previews
          WHERE id = ANY(${previewIds}::uuid[])
        `
      : [];
    const assetsById = new Map(
      assets.map(({ board_id, ...asset }) => [`${board_id}:${asset.id}`, asset]),
    );
    const previewsById = new Map(previews.map((preview) => [preview.id, preview]));
    return items.map((item): ItemResponse => {
      const base = noteResponse(item, role, showPricesTo);
      if (item.kind === 'note') {
        return base;
      }
      if (item.kind === 'image') {
        const asset = assetsById.get(`${item.board_id}:${item.asset_id}`);
        if (!asset) {
          throw new Error('Item asset missing');
        }
        return { ...base, kind: 'image', asset };
      }
      const preview = previewsById.get(item.link_preview_id!);
      if (!preview) {
        throw new Error('Item preview missing');
      }
      return {
        ...base,
        kind: 'link',
        preview: {
          ...preview,
          fetchedAt: preview.fetchedAt?.toISOString() ?? null,
          expiresAt: preview.expiresAt?.toISOString() ?? null,
        },
      };
    });
  }
  async update(manager: EntityManager, boardId: string, itemId: string, input: UpdateNoteRequest) {
    const { version, ...changes } = input;
    const patch = patchColumns(
      changes,
      { title: 'title', note: 'note', priceCents: 'price_cents', quantity: 'quantity' },
      4,
    );
    const rows = await manager.query<ItemRow[]>(
      `WITH updated AS (
        UPDATE items
        SET ${patch.assignments}, version = version + 1, updated_at = now()
        WHERE board_id = $1 AND id = $2 AND version = $3 AND deleted_at IS NULL
        RETURNING ${itemColumns}
      )
      SELECT ${itemColumns} FROM updated`,
      [boardId, itemId, version, ...patch.values],
    );
    return { item: rows[0] ?? null, changedFields: patch.changedFields };
  }
  async move(manager: EntityManager, boardId: string, itemId: string, input: MoveNoteRequest) {
    const patch = patchColumns(
      input,
      { x: 'x', y: 'y', zOrder: 'z_order', sectionId: 'section_id' },
      3,
    );
    const rows = await manager.query<ItemRow[]>(
      `WITH moved AS (
        UPDATE items
        SET ${patch.assignments}, updated_at = now()
        WHERE board_id = $1 AND id = $2 AND deleted_at IS NULL
        RETURNING ${itemColumns}
      )
      SELECT ${itemColumns} FROM moved`,
      [boardId, itemId, ...patch.values],
    );
    if (!rows[0]) {
      throw new NotFoundException('Item not found');
    }
    return { item: rows[0], changedFields: patch.changedFields };
  }
  async delete(manager: EntityManager, boardId: string, itemId: string): Promise<boolean> {
    const rows = await manager.sql<{ id: string }[]>`
      WITH deleted AS (
        UPDATE items
        SET deleted_at = now(), updated_at = now()
        WHERE board_id = ${boardId} AND id = ${itemId} AND deleted_at IS NULL
        RETURNING id
      )
      SELECT id FROM deleted
    `;
    return rows.length > 0;
  }
}
