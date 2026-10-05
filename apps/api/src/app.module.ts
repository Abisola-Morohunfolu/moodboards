import { resolve } from 'node:path';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config';
import { AuthModule } from './features/auth/auth.module';
import { StorageModule } from './platform/storage/storage.module';
import { AssetsModule } from './features/assets/assets.module';
import { HealthModule } from './features/health/health.module';
import { BoardsModule } from './features/boards/boards.module';
import { ItemsModule } from './features/items/items.module';
import { DatabaseModule } from './database/database.module';
import { ClientsModule } from './features/clients/clients.module';
import { ParticipantsModule } from './features/participants/participants.module';
import { ClientViewModule } from './features/client-view/client-view.module';

@Module({})
export class AppModule {
  static forRoot(environment?: Record<string, unknown>): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          skipProcessEnv: true,
          envFilePath: resolve(__dirname, '../../../.env'),
          ignoreEnvFile: environment !== undefined,
          ignoreEnvVars: environment !== undefined,
          validate: (values: Record<string, unknown>) => validateEnvironment(environment ?? values),
        }),
        DatabaseModule,
        HealthModule,
        AuthModule,
        BoardsModule,
        StorageModule,
        AssetsModule,
        ItemsModule,
        ClientsModule,
        ParticipantsModule,
        ClientViewModule,
      ],
    };
  }
}
