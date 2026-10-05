import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PresignRequest } from '@moodboard/contracts';
import { DataSource, EntityManager } from 'typeorm';
import { AccessService } from '../access/access.service';
import { MediaStorage } from '../../platform/storage/storage.module';
import { BoardPrincipal } from '../access/contact-access';
export interface AssetRecord {
  id: string;
  board_id: string;
  storage_key: string;
  thumbnail_key: string | null;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: number;
  width: number | null;
  height: number | null;
  palette: string[] | null;
  status: 'pending' | 'ready' | 'failed';
}
@Injectable()
export class AssetsService {
  constructor(
    private readonly source: DataSource,
    private readonly access: AccessService,
    private readonly media: MediaStorage,
  ) {}
  async load(manager: EntityManager, boardId: string, id: string): Promise<AssetRecord> {
    const rows: AssetRecord[] = await manager.query(
      'select * from assets where board_id=$1 and id=$2',
      [boardId, id],
    );
    if (!rows[0]) {
      throw new NotFoundException('Asset not found');
    }
    return rows[0];
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
        await manager.query(
          'insert into assets (id,board_id,storage_key,mime_type,bytes) values ($1,$2,$3,$4,$5)',
          [id, boardId, key, input.mime, input.bytes],
        );
      },
      false,
    );
    return { assetId: id, ...signed };
  }
  async assertUploaded(userId: string, boardId: string, id: string): Promise<AssetRecord> {
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
      object = await this.media.require().head(asset.storage_key);
    } catch {
      throw new ServiceUnavailableException('Media storage unavailable');
    }
    if (!object) {
      throw new ConflictException('Upload is not complete');
    }
    if (object.mime !== asset.mime_type || object.bytes !== asset.bytes) {
      throw new BadRequestException('Uploaded object does not match reservation');
    }
    return asset;
  }
  async url(userId: BoardPrincipal, id: string, variant: 'original' | 'thumbnail') {
    const rows: { board_id: string }[] = await this.source.query(
      'select board_id from assets where id=$1',
      [id],
    );
    if (!rows[0]) {
      throw new NotFoundException('Asset not found');
    }
    const asset = await this.access.withBoard(
      userId,
      rows[0].board_id,
      'board.view',
      (manager) => this.load(manager, rows[0]!.board_id, id),
      false,
    );
    if (asset.status !== 'ready') {
      throw new ConflictException('Asset is not ready');
    }
    const key = variant === 'original' ? asset.storage_key : asset.thumbnail_key;
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
        .presignGet(key, variant === 'thumbnail' ? 'image/webp' : asset.mime_type);
    } catch {
      throw new ServiceUnavailableException('Media storage unavailable');
    }
    // Signing is local, but access is rechecked so awaited adapters never reuse stale permission.
    await this.access.withBoard(userId, asset.board_id, 'board.view', async () => undefined, false);
    return signed;
  }
}
