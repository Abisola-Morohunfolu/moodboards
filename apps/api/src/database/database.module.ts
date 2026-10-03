import { Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from '@moodboard/database';
import { ApiConfig } from '../config';
import { migrations } from './migrations';

@Injectable()
class ShutdownLog implements OnApplicationShutdown {
  onApplicationShutdown(): void {
    new Logger('API').log('API shutdown complete');
  }
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiConfig, true>) => ({
        ...databaseOptions({
          url: config.get('DATABASE_URL', { infer: true }),
          poolMax: config.get('DB_POOL_MAX', { infer: true }),
          migrations,
        }),
        retryAttempts: 1,
      }),
    }),
  ],
  providers: [ShutdownLog],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
