import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { DataSource } from 'typeorm';

describe('API startup', () => {
  it('starts with valid configuration and serves the live route', async () => {
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({ DATABASE_URL: 'postgres://test:test@localhost/moodboard_test' }),
      ],
    })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .compile();
    const app = module.createNestApplication({ logger: false });
    try {
      await app.init();
      await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
    } finally {
      await app.close();
    }
  });
  it('rejects invalid configuration before startup', async () => {
    await expect(
      Test.createTestingModule({ imports: [AppModule.forRoot({})] }).compile(),
    ).rejects.toThrow('Invalid API configuration: DATABASE_URL');
  });
});
