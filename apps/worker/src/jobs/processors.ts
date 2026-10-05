import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DataSource, appendBoardEvent, resourceLock, withTransaction } from '@moodboard/database';
import { MediaJob, boardEventSchema } from '@moodboard/contracts';
import { Storage, ObjectTooLarge } from '@moodboard/storage';
import { generation, QueueName } from '../queues/media';
import { InvalidMedia, PageFetcher, EgressFetcher } from './egress';
import { parsePreview, PreviewMetadata } from './preview-parser';
interface Asset {
  id: string;
  board_id: string;
  storage_key: string;
  mime_type: string;
  bytes: number;
  status: string;
}
interface Preview {
  id: string;
  url: string;
  url_hash: Buffer;
  status: string;
  expires_at: Date | null;
}
export class MediaProcessors {
  constructor(
    readonly source: DataSource,
    readonly storage: Storage,
    readonly fetcher: PageFetcher = new EgressFetcher(),
  ) {}
  async image(job: MediaJob) {
    const rows: Asset[] = await this.source.query('select * from assets where id=$1', [
      job.entityId,
    ]);
    const asset = rows[0];
    if (!asset || asset.status !== 'pending') {
      return;
    }
    let body: Buffer;
    try {
      body = await this.storage.read(asset.storage_key, asset.bytes);
    } catch (error) {
      if (error instanceof ObjectTooLarge) {
        throw new InvalidMedia('Image size mismatch');
      }
      throw error;
    }
    if (body.length !== asset.bytes) {
      throw new InvalidMedia('Image size mismatch');
    }
    let thumbnail: Buffer;
    let width: number;
    let height: number;
    let palette: string[];
    try {
      if (asset.mime_type === 'image/png') {
        for (let offset = 8; offset + 12 <= body.length;) {
          const length = body.readUInt32BE(offset);
          if (body.toString('ascii', offset + 4, offset + 8) === 'acTL') {
            throw new InvalidMedia('Animated image');
          }
          offset += length + 12;
        }
      }
      const decoder = sharp(body, { limitInputPixels: 40_000_000, failOn: 'warning' });
      const info = await decoder.metadata();
      const expected: Record<string, string> = {
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };
      if (
        !info.format ||
        expected[info.format] !== asset.mime_type ||
        (info.pages ?? 1) > 1 ||
        !info.width ||
        !info.height
      ) {
        throw new InvalidMedia('Image format mismatch');
      }
      // A thumbnail forces a full decode and detects corrupt pixel data before promotion.
      const oriented = decoder.autoOrient();
      thumbnail = await oriented
        .clone()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp()
        .toBuffer();
      const orientation = info.orientation ?? 1;
      width = orientation >= 5 ? info.height : info.width;
      height = orientation >= 5 ? info.width : info.height;
      const pixels = await sharp(thumbnail)
        .resize(32, 32, { fit: 'inside' })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer();
      const counts = new Map<string, number>();
      for (let i = 0; i + 2 < pixels.length; i += 3) {
        const colour =
          '#' +
          [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
            .map((v) =>
              (Math.round(v / 32) * 32 > 255 ? 255 : Math.round(v / 32) * 32)
                .toString(16)
                .padStart(2, '0'),
            )
            .join('');
        counts.set(colour, (counts.get(colour) ?? 0) + 1);
      }
      palette = [...counts]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([colour]) => colour);
      while (palette.length < 5) {
        palette.push(palette[0] ?? '#000000');
      }
    } catch {
      throw new InvalidMedia('Invalid image');
    }
    const attempt = randomUUID();
    const original = `media/${asset.board_id}/${asset.id}/${attempt}/original`;
    const thumb = `media/${asset.board_id}/${asset.id}/${attempt}/thumbnail.webp`;
    await this.storage.put(original, body, asset.mime_type);
    await this.storage.put(thumb, thumbnail, 'image/webp');
    await withTransaction(this.source, async (manager) => {
      await manager.query('select id from boards where id=$1 for update', [asset.board_id]);
      const changed: unknown[] = await manager.query(
        "with changed as (update assets set storage_key=$2,thumbnail_key=$3,width=$4,height=$5,palette=$6,status='ready' where id=$1 and status='pending' returning id) select id from changed",
        [asset.id, original, thumb, width, height, palette],
      );
      if (changed.length) {
        await appendBoardEvent(
          manager,
          asset.board_id,
          null,
          boardEventSchema.parse({ type: 'asset.ready', payload: { assetId: asset.id } }),
        );
      }
    });
  }
  async preview(job: MediaJob) {
    const [preview]: Preview[] = await this.source.query(
      'select * from link_previews where id=$1',
      [job.entityId],
    );
    if (
      !preview ||
      generation(preview) !== job.generation ||
      (preview.expires_at && preview.expires_at.getTime() > Date.now())
    ) {
      return;
    }
    const page = await this.fetcher.fetch(preview.url);
    await this.finishPreview(job, parsePreview(page.html, page.url));
  }
  async fail(name: QueueName, job: MediaJob) {
    if (name === 'fetch-preview') {
      await this.finishPreview(job, null);
      return;
    }
    await withTransaction(this.source, async (manager) => {
      const [asset]: Asset[] = await manager.query('select * from assets where id=$1', [
        job.entityId,
      ]);
      if (!asset || asset.status !== 'pending') {
        return;
      }
      await manager.query('select id from boards where id=$1 for update', [asset.board_id]);
      const changed: unknown[] = await manager.query(
        "with changed as (update assets set status='failed' where id=$1 and status='pending' returning id) select id from changed",
        [asset.id],
      );
      if (changed.length) {
        await appendBoardEvent(
          manager,
          asset.board_id,
          null,
          boardEventSchema.parse({ type: 'asset.failed', payload: { assetId: asset.id } }),
        );
      }
    });
  }
  private async finishPreview(job: MediaJob, metadata: PreviewMetadata | null) {
    await withTransaction(this.source, async (manager) => {
      const [identity]: Preview[] = await manager.query('select * from link_previews where id=$1', [
        job.entityId,
      ]);
      if (!identity) {
        return;
      }
      await resourceLock(manager, `preview:${identity.url_hash.toString('hex')}`);
      const [preview]: Preview[] = await manager.query('select * from link_previews where id=$1', [
        job.entityId,
      ]);
      if (
        !preview ||
        generation(preview) !== job.generation ||
        (preview.expires_at && preview.expires_at.getTime() > Date.now())
      ) {
        return;
      }
      const boards: { id: string }[] = await manager.query(
        'select b.id from boards b where exists (select 1 from items i where i.board_id=b.id and i.link_preview_id=$1 and i.deleted_at is null) order by b.id for update',
        [preview.id],
      );
      if (metadata) {
        await manager.query(
          "update link_previews set title=$2,description=$3,image_url=$4,site_name=$5,status='ready',fetched_at=now(),expires_at=now()+interval '7 days' where id=$1",
          [preview.id, metadata.title, metadata.description, metadata.imageUrl, metadata.siteName],
        );
      } else {
        await manager.query(
          "update link_previews set status='failed',fetched_at=now(),expires_at=now()+interval '1 day' where id=$1",
          [preview.id],
        );
      }
      for (const board of boards) {
        // A delete can commit while the preceding board-lock query waits. Use a fresh
        // statement snapshot after acquiring the lock before emitting a board event.
        const references: unknown[] = await manager.query(
          'select 1 from items where board_id=$1 and link_preview_id=$2 and deleted_at is null limit 1',
          [board.id, preview.id],
        );
        if (!references.length) {
          continue;
        }
        await appendBoardEvent(
          manager,
          board.id,
          null,
          boardEventSchema.parse({
            type: metadata ? 'preview.ready' : 'preview.failed',
            payload: { previewId: preview.id },
          }),
        );
      }
    });
  }
}
