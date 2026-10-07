import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DataSource, appendBoardEvent, resourceLock, withTransaction } from '@moodboard/database';
import { MediaJob, boardEventSchema } from '@moodboard/contracts';
import { Storage, ObjectTooLarge } from '@moodboard/storage';
import { generation, QueueName } from '../queues/media';
import { InvalidMedia, PageFetcher, EgressFetcher } from './egress';
import { parsePreview, PreviewMetadata } from './preview-parser';
import { MediaRepository } from './media.repository';
export class MediaProcessors {
  private readonly repository = new MediaRepository();
  constructor(
    readonly source: DataSource,
    readonly storage: Storage,
    readonly fetcher: PageFetcher = new EgressFetcher(),
  ) {}
  async image(job: MediaJob) {
    const asset = await this.repository.asset(this.source.manager, job.entityId);
    if (!asset || asset.status !== 'pending') {
      return;
    }
    let body: Buffer;
    try {
      body = await this.storage.read(asset.storageKey, asset.bytes);
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
      if (asset.mimeType === 'image/png') {
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
        expected[info.format] !== asset.mimeType ||
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
    const original = `media/${asset.boardId}/${asset.id}/${attempt}/original`;
    const thumb = `media/${asset.boardId}/${asset.id}/${attempt}/thumbnail.webp`;
    await this.storage.put(original, body, asset.mimeType);
    await this.storage.put(thumb, thumbnail, 'image/webp');
    await withTransaction(this.source, async (manager) => {
      await this.repository.lockBoard(manager, asset.boardId);
      if (
        await this.repository.readyAsset(manager, asset.id, {
          storageKey: original,
          thumbnailKey: thumb,
          width,
          height,
          palette,
        })
      ) {
        await appendBoardEvent(
          manager,
          asset.boardId,
          null,
          boardEventSchema.parse({ type: 'asset.ready', payload: { assetId: asset.id } }),
        );
      }
    });
  }
  async preview(job: MediaJob) {
    const preview = await this.repository.preview(this.source.manager, job.entityId);
    if (
      !preview ||
      generation(preview) !== job.generation ||
      (preview.expiresAt && preview.expiresAt.getTime() > Date.now())
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
      const asset = await this.repository.asset(manager, job.entityId);
      if (!asset || asset.status !== 'pending') {
        return;
      }
      await this.repository.lockBoard(manager, asset.boardId);
      if (await this.repository.failAsset(manager, asset.id)) {
        await appendBoardEvent(
          manager,
          asset.boardId,
          null,
          boardEventSchema.parse({ type: 'asset.failed', payload: { assetId: asset.id } }),
        );
      }
    });
  }
  private async finishPreview(job: MediaJob, metadata: PreviewMetadata | null) {
    await withTransaction(this.source, async (manager) => {
      const identity = await this.repository.preview(manager, job.entityId);
      if (!identity) {
        return;
      }
      await resourceLock(manager, `preview:${identity.urlHash.toString('hex')}`);
      const preview = await this.repository.preview(manager, job.entityId);
      if (
        !preview ||
        generation(preview) !== job.generation ||
        (preview.expiresAt && preview.expiresAt.getTime() > Date.now())
      ) {
        return;
      }
      const boards = await this.repository.lockPreviewBoards(manager, preview.id);
      await this.repository.finishPreview(manager, preview.id, metadata);
      for (const board of boards) {
        // A delete can commit while the preceding board-lock query waits. Use a fresh
        // statement snapshot after acquiring the lock before emitting a board event.
        if (!(await this.repository.hasPreviewReferences(manager, board.id, preview.id))) {
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
