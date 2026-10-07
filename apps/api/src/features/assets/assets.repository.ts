import { Injectable, NotFoundException } from '@nestjs/common';
import { PresignRequest } from '@moodboard/contracts';
import { AssetEntity } from '@moodboard/database';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class AssetsRepository {
  constructor(private readonly source: DataSource) {}
  async load(manager: EntityManager, boardId: string, id: string): Promise<AssetEntity> {
    const asset = await manager
      .createQueryBuilder(AssetEntity, 'asset')
      .where('asset.boardId = :boardId AND asset.id = :id', { boardId, id })
      .getOne();
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return asset;
  }
  async reserve(
    manager: EntityManager,
    id: string,
    boardId: string,
    storageKey: string,
    input: PresignRequest,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(AssetEntity)
      .values({ id, boardId, storageKey, mimeType: input.mime, bytes: input.bytes })
      .execute();
  }
  async boardId(id: string): Promise<string> {
    const asset = await this.source.manager
      .createQueryBuilder(AssetEntity, 'asset')
      .select(['asset.id', 'asset.boardId'])
      .where('asset.id = :id', { id })
      .getOne();
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }
    return asset.boardId;
  }
}
