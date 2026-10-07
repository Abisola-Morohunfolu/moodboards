import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PresignRequest } from '@moodboard/contracts';
import { EntityManager } from 'typeorm';
import { AssetEntity } from '@moodboard/database';
import { AssetsRepository } from './assets.repository';
import { AccessService } from '../access/access.service';
import { MediaStorage } from '../../platform/storage/storage.module';
import { BoardPrincipal } from '../access/contact-access';
@Injectable()
export class AssetsService {
  constructor(
    private readonly repository: AssetsRepository,
    private readonly access: AccessService,
    private readonly media: MediaStorage,
  ) {}
  async load(manager: EntityManager, boardId: string, id: string): Promise<AssetEntity> {
    return this.repository.load(manager, boardId, id);
  }
  async presign(userId: string, boardId: string, input: PresignRequest) {
    await this.access.withBoard(userId, boardId, 'item.create', async () => undefined, false);
    if (input.bytes > this.media.maxBytes) {
      throw new BadRequestException('Upload exceeds byte limit');
    }
    const storage = this.media.require();
    const id = randomUUID();
    const key = `staging/${boardId.toLowerCase()}/${id}`;
    let signed;
    try {
      await storage.ready();
      signed = await storage.presignPut(key, input.mime, input.bytes);
    } catch {
      throw new ServiceUnavailableException('Media storage unavailable');
    }
    await this.access.withBoard(
      userId,
      boardId,
      'item.create',
      async (manager) => {
        await this.repository.reserve(manager, id, boardId, key, input);
      },
      false,
    );
    return { assetId: id, ...signed };
  }
  async assertUploaded(userId: string, boardId: string, id: string): Promise<AssetEntity> {
    const asset = await this.access.withBoard(
      userId,
      boardId,
      'item.create',
      (manager) => this.load(manager, boardId, id),
      false,
    );
    if (asset.status === 'failed') {
      throw new ConflictException('Asset processing failed');
    }
    if (asset.status === 'ready') {
      return asset;
    }
    let object;
    try {
      object = await this.media.require().head(asset.storageKey);
    } catch {
      throw new ServiceUnavailableException('Media storage unavailable');
    }
    if (!object) {
      throw new ConflictException('Upload is not complete');
    }
    if (object.mime !== asset.mimeType || object.bytes !== asset.bytes) {
      throw new BadRequestException('Uploaded object does not match reservation');
    }
    return asset;
  }
  async url(userId: BoardPrincipal, id: string, variant: 'original' | 'thumbnail') {
    const boardId = await this.repository.boardId(id);
    const asset = await this.access.withBoard(
      userId,
      boardId,
      'board.view',
      (manager) => this.load(manager, boardId, id),
      false,
    );
    if (asset.status !== 'ready') {
      throw new ConflictException('Asset is not ready');
    }
    const key = variant === 'original' ? asset.storageKey : asset.thumbnailKey;
    if (!key || key.startsWith('staging/')) {
      throw new ConflictException('Asset is not ready');
    }
    let signed;
    try {
      const stored = await this.media.require().head(key);
      if (!stored) {
        throw new ServiceUnavailableException('Media object unavailable');
      }
      signed = await this.media
        .require()
        .presignGet(key, variant === 'thumbnail' ? 'image/webp' : asset.mimeType);
    } catch {
      throw new ServiceUnavailableException('Media storage unavailable');
    }
    // Signing is local, but access is rechecked so awaited adapters never reuse stale permission.
    await this.access.withBoard(userId, asset.boardId, 'board.view', async () => undefined, false);
    return signed;
  }
}
