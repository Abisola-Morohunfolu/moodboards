import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LinkPreviewEntity } from '@moodboard/database';

@Injectable()
export class ItemPreviewsRepository {
  async findOrCreate(manager: EntityManager, url: string, urlHash: Buffer): Promise<string> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(LinkPreviewEntity)
      .values({ id: randomUUID(), url, urlHash })
      .onConflict('(url_hash) DO NOTHING')
      .execute();
    const preview = await manager
      .createQueryBuilder(LinkPreviewEntity, 'preview')
      .select(['preview.id'])
      .where('preview.urlHash = :urlHash', { urlHash })
      .getOne();
    if (!preview) {
      throw new Error('Link preview missing after insert');
    }
    return preview.id;
  }
}
