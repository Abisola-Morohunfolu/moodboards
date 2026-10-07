import {
  AssetEntity,
  BoardEntity,
  ContactSessionEntity,
  ItemEntity,
  LinkPreviewEntity,
  EntityManager,
} from '@moodboard/database';

export class MaintenanceRepository {
  pendingAssets(manager: EntityManager) {
    const references = manager
      .createQueryBuilder(ItemEntity, 'item')
      .select('1')
      .where('item.assetId = asset.id AND item.deletedAt IS NULL');
    return manager
      .createQueryBuilder(AssetEntity, 'asset')
      .select(['asset.id'])
      .where("asset.status = 'pending'")
      .andWhere(`EXISTS (${references.getQuery()})`)
      .getMany();
  }
  referencedPreviews(manager: EntityManager, expired: boolean) {
    const references = manager
      .createQueryBuilder(ItemEntity, 'item')
      .select('1')
      .where('item.linkPreviewId = preview.id AND item.deletedAt IS NULL');
    return manager
      .createQueryBuilder(LinkPreviewEntity, 'preview')
      .select(['preview.id', 'preview.expiresAt'])
      .where(expired ? 'preview.expiresAt <= now()' : "preview.status = 'pending'")
      .andWhere(`EXISTS (${references.getQuery()})`)
      .getMany();
  }
  orphanAssets(manager: EntityManager, before: Date) {
    const references = manager
      .createQueryBuilder(ItemEntity, 'item')
      .select('1')
      .where('item.assetId = asset.id');
    return manager
      .createQueryBuilder(AssetEntity, 'asset')
      .select(['asset.id', 'asset.boardId'])
      .where('asset.createdAt < :before', { before })
      .andWhere(`NOT EXISTS (${references.getQuery()})`)
      .orderBy('asset.boardId')
      .addOrderBy('asset.id')
      .getMany();
  }
  async removeOrphan(
    manager: EntityManager,
    id: string,
    boardId: string,
    before: Date,
  ): Promise<number> {
    await manager
      .createQueryBuilder(BoardEntity, 'board')
      .select(['board.id'])
      .where('board.id = :boardId', { boardId })
      .setLock('pessimistic_write')
      .getOne();
    const references = manager
      .createQueryBuilder(ItemEntity, 'item')
      .select('1')
      .where('item.assetId = assets.id');
    const result = await manager
      .createQueryBuilder()
      .delete()
      .from(AssetEntity)
      .where(`id = :id AND created_at < :before AND NOT EXISTS (${references.getQuery()})`, {
        id,
        before,
      })
      .execute();
    return result.affected ?? 0;
  }
  hasObjectReferences(manager: EntityManager, key: string) {
    return manager
      .createQueryBuilder(AssetEntity, 'asset')
      .where('asset.storageKey = :key OR asset.thumbnailKey = :key', { key })
      .getExists();
  }
  async pruneBatch(manager: EntityManager, before: Date): Promise<number> {
    const rows = await manager.sql<{ id: string }[]>`
      WITH old AS (
        SELECT id FROM board_events WHERE dispatched_at < ${before} ORDER BY id LIMIT 10000
      ), removed AS (
        DELETE FROM board_events e USING old WHERE e.id = old.id RETURNING e.id
      ) SELECT id FROM removed
    `;
    return rows.length;
  }
  async purgeContactSessions(manager: EntityManager, now: Date) {
    await manager
      .createQueryBuilder()
      .delete()
      .from(ContactSessionEntity)
      .where('expires_at <= :now', { now })
      .execute();
  }
}
