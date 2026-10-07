import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

@Injectable()
export class ItemPreviewsRepository {
  async findOrCreate(manager: EntityManager, url: string, urlHash: Buffer): Promise<string> {
    await manager.sql`
      INSERT INTO link_previews (id, url, url_hash)
      VALUES (${randomUUID()}, ${url}, ${urlHash})
      ON CONFLICT (url_hash) DO NOTHING
    `;
    const [preview] = await manager.sql<{ id: string }[]>`
      SELECT id
      FROM link_previews
      WHERE url_hash = ${urlHash}
    `;
    if (!preview) {
      throw new Error('Link preview missing after insert');
    }
    return preview.id;
  }
}
