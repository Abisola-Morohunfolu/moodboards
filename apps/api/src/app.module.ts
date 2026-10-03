import { resolve } from 'node:path';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config';
import { AuthModule } from './features/auth/auth.module';
import { HealthModule } from './features/health/health.module';
import { DatabaseModule } from './database/database.module';

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
      ],
    };
  }
}
