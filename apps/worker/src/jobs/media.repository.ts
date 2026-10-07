import {
  AssetEntity,
  BoardEntity,
  ItemEntity,
  LinkPreviewEntity,
  EntityManager,
} from '@moodboard/database';
import { PreviewMetadata } from './preview-parser';

export class MediaRepository {
  asset(manager: EntityManager, id: string) {
    return manager
      .createQueryBuilder(AssetEntity, 'asset')
      .where('asset.id = :id', { id })
      .getOne();
  }
  preview(manager: EntityManager, id: string) {
    return manager
      .createQueryBuilder(LinkPreviewEntity, 'preview')
      .where('preview.id = :id', { id })
      .getOne();
  }
  async lockBoard(manager: EntityManager, boardId: string) {
    await manager
      .createQueryBuilder(BoardEntity, 'board')
      .select(['board.id'])
      .where('board.id = :boardId', { boardId })
      .setLock('pessimistic_write')
      .getOne();
  }
  async readyAsset(
    manager: EntityManager,
    id: string,
    input: Pick<AssetEntity, 'storageKey' | 'thumbnailKey' | 'width' | 'height' | 'palette'>,
  ) {
    const result = await manager
      .createQueryBuilder()
      .update(AssetEntity)
      .set({ ...input, status: 'ready' })
      .where("id = :id AND status = 'pending'", { id })
      .execute();
    return (result.affected ?? 0) > 0;
  }
  async failAsset(manager: EntityManager, id: string) {
    const result = await manager
      .createQueryBuilder()
      .update(AssetEntity)
      .set({ status: 'failed' })
      .where("id = :id AND status = 'pending'", { id })
      .execute();
    return (result.affected ?? 0) > 0;
  }
  lockPreviewBoards(manager: EntityManager, previewId: string) {
    const references = manager
      .createQueryBuilder(ItemEntity, 'item')
      .select('1')
      .where(
        'item.boardId = board.id AND item.linkPreviewId = :previewId AND item.deletedAt IS NULL',
        { previewId },
      );
    return manager
      .createQueryBuilder(BoardEntity, 'board')
      .select(['board.id'])
      .where(`EXISTS (${references.getQuery()})`)
      .setParameters(references.getParameters())
      .orderBy('board.id')
      .setLock('pessimistic_write')
      .getMany();
  }
  async finishPreview(manager: EntityManager, id: string, metadata: PreviewMetadata | null) {
    const update = manager.createQueryBuilder().update(LinkPreviewEntity);
    if (metadata) {
      update.set({
        ...metadata,
        status: 'ready',
        fetchedAt: () => 'now()',
        expiresAt: () => "now() + interval '7 days'",
      });
    } else {
      update.set({
        status: 'failed',
        fetchedAt: () => 'now()',
        expiresAt: () => "now() + interval '1 day'",
      });
    }
    await update.where('id = :id', { id }).execute();
  }
  hasPreviewReferences(manager: EntityManager, boardId: string, previewId: string) {
    return manager
      .createQueryBuilder(ItemEntity, 'item')
      .where(
        'item.boardId = :boardId AND item.linkPreviewId = :previewId AND item.deletedAt IS NULL',
        { boardId, previewId },
      )
      .getExists();
  }
}
