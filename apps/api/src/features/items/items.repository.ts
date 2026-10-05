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

export interface NoteRecord {
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
type AssetMetadata = Extract<ItemResponse, { kind: 'image' }>['asset'];
type PreviewMetadata = Omit<
  Extract<ItemResponse, { kind: 'link' }>['preview'],
  'fetchedAt' | 'expiresAt'
> & { fetchedAt: Date | null; expiresAt: Date | null };
export function noteResponse(
  item: NoteRecord,
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
    const rows: { board_id: string }[] = await this.source.manager.query(
      'select board_id from items where id=$1',
      [itemId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Item not found');
    }
    return rows[0].board_id;
  }
  list(manager: EntityManager, boardId: string): Promise<NoteRecord[]> {
    return manager.query(
      `select * from items where board_id=$1 and deleted_at is null
      order by z_order collate "C", id`,
      [boardId],
    );
  }
  async get(manager: EntityManager, boardId: string, itemId: string): Promise<NoteRecord> {
    const rows: NoteRecord[] = await manager.query(
      'select * from items where board_id=$1 and id=$2',
      [boardId, itemId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Item not found');
    }
    return rows[0];
  }
  async existing(
    manager: EntityManager,
    boardId: string,
    itemId: string,
  ): Promise<NoteRecord | null> {
    const rows: NoteRecord[] = await manager.query('select * from items where id=$1', [itemId]);
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
    const rows: NoteRecord[] = await manager.query(
      `insert into items
      (id, board_id, section_id, created_by, kind, title, note, x, y, z_order, price_cents, quantity, asset_id, link_preview_id)
      values ($1,$2,$3,$4,$12,$5,$6,$7,$8,$9,$10,$11,$13,$14)
      on conflict (id) do nothing returning *`,
      [
        input.id,
        boardId,
        input.sectionId ?? null,
        participantId,
        input.title ?? null,
        input.note ?? null,
        input.x ?? 0,
        input.y ?? 0,
        input.zOrder,
        input.priceCents ?? null,
        input.quantity ?? 1,
        input.kind,
        input.kind === 'image' ? input.assetId : null,
        previewId,
      ],
    );
    if (rows[0]) {
      return { item: rows[0], created: true };
    }
    return { item: (await this.existing(manager, boardId, input.id))!, created: false };
  }
  async response(
    manager: EntityManager,
    item: NoteRecord,
    role: BoardRole,
    showPricesTo: BoardRole,
  ): Promise<ItemResponse> {
    return (await this.responses(manager, [item], role, showPricesTo))[0]!;
  }
  async responses(
    manager: EntityManager,
    items: NoteRecord[],
    role: BoardRole,
    showPricesTo: BoardRole,
  ): Promise<ItemResponse[]> {
    const assetIds = [
      ...new Set(items.flatMap((item) => (item.kind === 'image' ? [item.asset_id] : []))),
    ];
    const previewIds = [
      ...new Set(items.flatMap((item) => (item.kind === 'link' ? [item.link_preview_id] : []))),
    ];
    const assets: (AssetMetadata & { board_id: string })[] = assetIds.length
      ? await manager.query(
          'select id,board_id,status,mime_type as mime,bytes,width,height,palette from assets where id=any($1::uuid[])',
          [assetIds],
        )
      : [];
    const previews: PreviewMetadata[] = previewIds.length
      ? await manager.query(
          'select id,url,status,title,description,image_url as "imageUrl",site_name as "siteName",fetched_at as "fetchedAt",expires_at as "expiresAt" from link_previews where id=any($1::uuid[])',
          [previewIds],
        )
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
    const rows: NoteRecord[] = await manager.query(
      `with updated as (update items
      set ${patch.assignments}, version=version+1, updated_at=now()
      where board_id=$1 and id=$2 and version=$3 and deleted_at is null
      returning *) select * from updated`,
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
    const rows: NoteRecord[] = await manager.query(
      `with moved as (update items set ${patch.assignments}, updated_at=now()
      where board_id=$1 and id=$2 and deleted_at is null returning *) select * from moved`,
      [boardId, itemId, ...patch.values],
    );
    if (!rows[0]) {
      throw new NotFoundException('Item not found');
    }
    return { item: rows[0], changedFields: patch.changedFields };
  }
  async delete(manager: EntityManager, boardId: string, itemId: string): Promise<boolean> {
    const rows: { id: string }[] = await manager.query(
      `with deleted as (update items set deleted_at=now(), updated_at=now()
      where board_id=$1 and id=$2 and deleted_at is null returning id) select id from deleted`,
      [boardId, itemId],
    );
    return rows.length > 0;
  }
}
