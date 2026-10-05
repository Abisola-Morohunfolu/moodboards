import {
  Global,
  Module,
  Injectable,
  ServiceUnavailableException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { R2Storage, Storage, r2Config } from '@moodboard/storage';
@Injectable()
export class MediaStorage implements OnModuleDestroy {
  readonly storage: Storage | null;
  readonly maxBytes: number;
  constructor(config: ConfigService) {
    const fields = [
      'R2_ACCOUNT_ID',
      'R2_BUCKET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'MEDIA_UPLOAD_MAX_BYTES',
    ];
    const options = r2Config(Object.fromEntries(fields.map((key) => [key, config.get(key)])));
    this.storage = options ? new R2Storage(options) : null;
    this.maxBytes = config.get<number>('MEDIA_UPLOAD_MAX_BYTES') ?? 10 * 1024 * 1024;
  }
  require(): Storage {
    if (!this.storage) {
      throw new ServiceUnavailableException('Media storage unavailable');
    }
    return this.storage;
  }
  onModuleDestroy() {
    this.storage?.close();
  }
}
@Global()
@Module({ providers: [MediaStorage], exports: [MediaStorage] })
export class StorageModule {}
