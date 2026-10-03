import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { configureHttp } from './app.setup';
import { AppModule } from './app.module';
import { ApiConfig } from './config';

export async function bootstrap(): Promise<void> {
  const logger = new ConsoleLogger('API', { json: true });
  const app = await NestFactory.create(AppModule.forRoot(), { logger, abortOnError: false });
  configureHttp(app);
  app.enableShutdownHooks();
  const config = app.get(ConfigService<ApiConfig, true>);
  try {
    await app.listen(
      config.get('API_PORT', { infer: true }),
      config.get('API_HOST', { infer: true }),
    );
    logger.log('API startup complete');
  } catch (error) {
    await app.close();
    throw error;
  }
}

if (require.main === module) {
  void bootstrap().catch(() => {
    new ConsoleLogger('API', { json: true }).error(
      'API startup failed. Check configuration and database access.',
    );
    process.exitCode = 1;
  });
}
