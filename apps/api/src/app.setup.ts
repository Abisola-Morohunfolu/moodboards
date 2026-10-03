import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiConfig } from './config';

export function configureHttp(app: INestApplication): void {
  const config = app.get(ConfigService<ApiConfig, true>);
  const origins = config.get('AUTH_ALLOWED_ORIGINS', { infer: true });
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });
  // Account responses must not be cached by a browser or intermediary.
  app.use(
    (
      _request: unknown,
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
}
