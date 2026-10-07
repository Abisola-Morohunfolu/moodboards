import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BoardRole,
  CreateItemRequest,
  MoveNoteRequest,
  UpdateNoteRequest,
} from '@moodboard/contracts';
import {
  AssetEntity,
  ItemEntity,
  LinkPreviewEntity,
  definedPatch,
  entityFromRow,
} from '@moodboard/database';
import { DataSource, EntityManager } from 'typeorm';
import { itemResponses } from './items.mapper';

@Injectable()
export class ItemsRepository {
  constructor(private readonly source: DataSource) {}
  async boardId(itemId: string): Promise<string> {
    const item = await this.source.manager
      .createQueryBuilder(ItemEntity, 'item')
      .select(['item.id', 'item.boardId'])
      .where('item.id = :itemId', { itemId })
      .getOne();
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    return item.boardId;
  }
  list(manager: EntityManager, boardId: string): Promise<ItemEntity[]> {
    return manager
      .createQueryBuilder(ItemEntity, 'item')
      .where('item.boardId = :boardId', { boardId })
      .andWhere('item.deletedAt IS NULL')
      .orderBy('item.zOrder COLLATE "C"')
      .addOrderBy('item.id')
      .getMany();
  }
  async get(manager: EntityManager, boardId: string, itemId: string): Promise<ItemEntity> {
    const item = await manager
      .createQueryBuilder(ItemEntity, 'item')
      .where('item.boardId = :boardId AND item.id = :itemId', { boardId, itemId })
      .getOne();
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    return item;
  }
  async existing(
    manager: EntityManager,
    boardId: string,
    itemId: string,
  ): Promise<ItemEntity | null> {
    const item = await manager
      .createQueryBuilder(ItemEntity, 'item')
      .where('item.id = :itemId', { itemId })
      .getOne();
    if (item && item.boardId !== boardId.toLowerCase()) {
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
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ItemEntity)
      .values({
        id: input.id,
        boardId,
        sectionId: input.sectionId ?? null,
        createdBy: participantId,
        kind: input.kind,
        title: input.title ?? null,
        note: input.note ?? null,
        x: input.x ?? 0,
        y: input.y ?? 0,
        zOrder: input.zOrder,
        priceCents: input.priceCents ?? null,
        quantity: input.quantity ?? 1,
        assetId: input.kind === 'image' ? input.assetId : null,
        linkPreviewId: previewId,
      })
      .onConflict('(id) DO NOTHING')
      .returning('*')
      .execute();
    const row = result.raw[0];
    if (row) {
      return { item: entityFromRow(manager, ItemEntity, row), created: true };
    }
    return { item: (await this.existing(manager, boardId, input.id))!, created: false };
  }
  async response(
    manager: EntityManager,
    item: ItemEntity,
    role: BoardRole,
    showPricesTo: BoardRole,
  ) {
    return (await this.responses(manager, [item], role, showPricesTo))[0]!;
  }
  async responses(
    manager: EntityManager,
    items: ItemEntity[],
    role: BoardRole,
    showPricesTo: BoardRole,
  ) {
    const assetIds = [
      ...new Set(
        items.flatMap((item) => (item.kind === 'image' && item.assetId ? [item.assetId] : [])),
      ),
    ];
    const previewIds = [
      ...new Set(
        items.flatMap((item) =>
          item.kind === 'link' && item.linkPreviewId ? [item.linkPreviewId] : [],
        ),
      ),
    ];
    const assets = assetIds.length
      ? await manager
          .createQueryBuilder(AssetEntity, 'asset')
          .select([
            'asset.id',
            'asset.boardId',
            'asset.status',
            'asset.mimeType',
            'asset.bytes',
            'asset.width',
            'asset.height',
            'asset.palette',
          ])
          .where('asset.id IN (:...assetIds)', { assetIds })
          .getMany()
      : [];
    const previews = previewIds.length
      ? await manager
          .createQueryBuilder(LinkPreviewEntity, 'preview')
          .select([
            'preview.id',
            'preview.url',
            'preview.status',
            'preview.title',
            'preview.description',
            'preview.imageUrl',
            'preview.siteName',
            'preview.fetchedAt',
            'preview.expiresAt',
          ])
          .where('preview.id IN (:...previewIds)', { previewIds })
          .getMany()
      : [];
    return itemResponses(items, assets, previews, role, showPricesTo);
  }
  async update(manager: EntityManager, boardId: string, itemId: string, input: UpdateNoteRequest) {
    const patch = definedPatch(input, ['title', 'note', 'priceCents', 'quantity'] as const);
    const result = await manager
      .createQueryBuilder()
      .update(ItemEntity)
      .set({ ...patch.values, version: () => 'version + 1', updatedAt: () => 'now()' })
      .where('board_id = :boardId AND id = :itemId AND version = :version AND deleted_at IS NULL', {
        boardId,
        itemId,
        version: input.version,
      })
      .returning('*')
      .execute();
    return {
      item: result.raw[0] ? entityFromRow(manager, ItemEntity, result.raw[0]) : null,
      changedFields: patch.changedFields,
    };
  }
  async move(manager: EntityManager, boardId: string, itemId: string, input: MoveNoteRequest) {
    const patch = definedPatch(input, ['x', 'y', 'zOrder', 'sectionId'] as const);
    const result = await manager
      .createQueryBuilder()
      .update(ItemEntity)
      .set({ ...patch.values, updatedAt: () => 'now()' })
      .where('board_id = :boardId AND id = :itemId AND deleted_at IS NULL', { boardId, itemId })
      .returning('*')
      .execute();
    if (!result.raw[0]) {
      throw new NotFoundException('Item not found');
    }
    return {
      item: entityFromRow(manager, ItemEntity, result.raw[0]),
      changedFields: patch.changedFields,
    };
  }
  async delete(manager: EntityManager, boardId: string, itemId: string): Promise<boolean> {
    const result = await manager
      .createQueryBuilder()
      .update(ItemEntity)
      .set({ deletedAt: () => 'now()', updatedAt: () => 'now()' })
      .where('board_id = :boardId AND id = :itemId AND deleted_at IS NULL', { boardId, itemId })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
