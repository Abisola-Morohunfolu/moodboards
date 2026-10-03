import { Controller, Get, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  accountResponseSchema,
  workspaceListResponseSchema,
  workspaceResponseSchema,
} from '@moodboard/contracts';
import { AppModule } from '../apps/api/src/app.module';
import { configureHttp } from '../apps/api/src/app.setup';
import { AuthPrincipal, CurrentUser, Public } from '../apps/api/src/features/auth/auth.decorators';
import { FLOW_COOKIE, SESSION_COOKIE, tokenHash } from '../apps/api/src/features/auth/cookies';
import { GoogleService } from '../apps/api/src/features/auth/google.service';
import { testDatabaseUrl, testDataSource } from './database';

@Controller('test-only')
class DefaultPrivateController {
  @Get()
  get(@CurrentUser() user: AuthPrincipal) {
    return user;
  }
  @Public()
  @Get('public')
  publicRoute() {
    return { public: true };
  }
}
function responseCookie(response: request.Response, name = SESSION_COOKIE): string {
  const cookies = response.headers['set-cookie'] as unknown as string[];
  return cookies.find((cookie) => cookie.startsWith(`${name}=`))!.split(';')[0]!;
}
describe('Account and workspace HTTP onboarding', () => {
  const source = testDataSource(5);
  const databaseUrl = testDatabaseUrl();
  const developmentUrl = process.env.DATABASE_URL;
  let app: INestApplication;
  let google: GoogleService;
  const input = {
    email: 'planner@example.com',
    password: 'correct horse battery staple',
    displayName: 'Planner',
  };
  const identity = {
    subject: 'google-user-1',
    email: 'google@example.com',
    displayName: 'Google User',
    avatarUrl: null,
  };
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          DATABASE_URL: databaseUrl,
          GOOGLE_CLIENT_ID: 'test-client',
          GOOGLE_CLIENT_SECRET: 'test-secret',
          GOOGLE_CALLBACK_URL: 'http://127.0.0.1:3001/auth/google/callback',
        }),
      ],
      controllers: [DefaultPrivateController],
    })
      .overrideProvider(DataSource)
      .useValue(source)
      .compile();
    // Nest configuration assigns validated values to process.env. Keep the
    // development-database guard independent of this test app's configuration.
    if (developmentUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = developmentUrl;
    }
    app = module.createNestApplication({ logger: false });
    configureHttp(app);
    google = app.get(GoogleService);
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    await source.query(
      'truncate users, workspaces, auth_rate_limits, google_auth_attempts cascade',
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await source.query(
      'truncate users, workspaces, auth_rate_limits, google_auth_attempts cascade',
    );
    await app.close();
    if (source.isInitialized) {
      await source.destroy();
    }
  });
  async function signup(email = input.email) {
    return request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...input, email })
      .expect(201);
  }
  async function googleFlow() {
    const start = await request(app.getHttpServer()).get('/auth/google').expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state')!;
    return { state, cookie: responseCookie(start, FLOW_COOKIE) };
  }
  it('protects every private endpoint and an unannotated route by default', async () => {
    for (const path of ['/me', '/workspaces', '/test-only']) {
      await request(app.getHttpServer()).get(path).expect(401);
    }
    await request(app.getHttpServer()).post('/workspaces').send({ name: 'Team' }).expect(401);
    await request(app.getHttpServer()).post('/auth/logout').send({}).expect(401);
    await request(app.getHttpServer()).get('/test-only/public').expect(200, { public: true });
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });
  it('completes signup, workspace creation, logout and login with safe responses', async () => {
    const created = await signup('  Planner@Example.com ');
    const account = accountResponseSchema.parse(created.body);
    expect(account.user.email).toBe(input.email);
    expect(account.workspaces).toHaveLength(1);
    expect(account.workspaces[0]).toMatchObject({
      type: 'personal',
      role: 'owner',
      name: 'Personal',
    });
    const cookie = responseCookie(created);
    const header = (created.headers['set-cookie'] as unknown as string[])[0]!;
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=604800');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Secure');
    expect(created.headers['cache-control']).toBe('no-store');
    const token = cookie.split('=')[1]!;
    expect(await source.query('select token_hash from auth_sessions')).toEqual([
      { token_hash: tokenHash(token) },
    ]);
    await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(200, account);
    const principal = await request(app.getHttpServer())
      .get('/test-only')
      .set('Cookie', cookie)
      .expect(200);
    expect(principal.body).toEqual({ userId: account.user.id, sessionHash: tokenHash(token) });
    const team = await request(app.getHttpServer())
      .post('/workspaces')
      .set('Cookie', cookie)
      .send({ name: ' Team ' })
      .expect(201);
    expect(workspaceResponseSchema.parse(team.body)).toMatchObject({
      type: 'business',
      name: 'Team',
      role: 'owner',
    });
    const listing = await request(app.getHttpServer())
      .get('/workspaces')
      .set('Cookie', cookie)
      .expect(200);
    expect(workspaceListResponseSchema.parse(listing.body)).toHaveLength(2);
    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .send({})
      .expect(204);
    expect(String(logout.headers['set-cookie'])).toContain('Expires=Thu, 01 Jan 1970');
    await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(401);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'PLANNER@EXAMPLE.COM', password: input.password })
      .expect(200);
    expect(login.body.user.id).toBe(account.user.id);
    expect(responseCookie(login)).not.toBe(cookie);
  });
  it('isolates workspace memberships and rejects owner spoofing', async () => {
    const first = await signup();
    const second = await signup('other@example.com');
    const firstCookie = responseCookie(first);
    const secondCookie = responseCookie(second);
    const team = await request(app.getHttpServer())
      .post('/workspaces')
      .set('Cookie', firstCookie)
      .send({ name: 'Team' })
      .expect(201);
    const listing = await request(app.getHttpServer())
      .get('/workspaces')
      .set('Cookie', secondCookie)
      .expect(200);
    expect(listing.body.map((workspace: { id: string }) => workspace.id)).not.toContain(
      team.body.id,
    );
    await request(app.getHttpServer())
      .post('/workspaces')
      .set('Cookie', firstCookie)
      .send({ name: 'Bad', userId: second.body.user.id })
      .expect(400);
  });
  it('rejects duplicate emails and invalid credentials uniformly', async () => {
    await signup();
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...input, email: 'PLANNER@EXAMPLE.COM' })
      .expect(409);
    const wrong = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: input.email, password: 'wrong' })
      .expect(401);
    const missing = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'missing@example.com', password: 'wrong' })
      .expect(401);
    expect(wrong.body).toEqual(missing.body);
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...input, password: 'short' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...input, role: 'owner' })
      .expect(400);
  });
  it('rejects expired, deleted-user and malformed sessions', async () => {
    const created = await signup();
    const cookie = responseCookie(created);
    await source.query("update auth_sessions set expires_at=now()-interval '1 second'");
    await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(401);
    await source.query("update auth_sessions set expires_at=now()+interval '1 day'");
    await source.query(
      "update users set deleted_at=now(), email=null, display_name='', avatar_url=null",
    );
    await request(app.getHttpServer()).get('/me').set('Cookie', cookie).expect(401);
    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', `${SESSION_COOKIE}=bad`)
      .expect(401);
  });
  it('logout revokes only the current session', async () => {
    const first = await signup();
    const second = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: input.email, password: input.password })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', responseCookie(first))
      .send({})
      .expect(204);
    await request(app.getHttpServer()).get('/me').set('Cookie', responseCookie(second)).expect(200);
  });
  it('enforces origins and JSON bodies, including public auth routes', async () => {
    await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', 'https://evil.example')
      .send(input)
      .expect(403);
    await request(app.getHttpServer())
      .post('/auth/login')
      .type('form')
      .send({ email: input.email, password: input.password })
      .expect(400);
    const allowed = await request(app.getHttpServer())
      .post('/auth/signup')
      .set('Origin', 'http://localhost:3000')
      .send(input)
      .expect(201);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await request(app.getHttpServer())
      .options('/auth/signup')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rate limits signup and login before expensive password work', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: input.email, password: 'wrong' })
        .expect(401);
    }
    const limited = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: input.email, password: 'wrong' })
      .expect(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    for (let attempt = 0; attempt < 5; attempt++) {
      await signup(`person${attempt}@example.com`);
    }
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...input, email: 'sixth@example.com' })
      .expect(429);
  });
  it('supports Google signup and returning login without duplicate workspaces or profile changes', async () => {
    const exchange = jest.spyOn(google, 'exchange').mockResolvedValue(identity);
    const first = await googleFlow();
    const signedUp = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: first.state, code: 'code' })
      .set('Cookie', first.cookie)
      .expect(200);
    expect(accountResponseSchema.parse(signedUp.body).workspaces).toHaveLength(1);
    expect(await source.query('select password_hash from users')).toEqual([
      { password_hash: null },
    ]);
    await request(app.getHttpServer())
      .get('/me')
      .set('Cookie', responseCookie(signedUp))
      .expect(200);
    exchange.mockResolvedValue({
      ...identity,
      email: 'changed@example.com',
      displayName: 'Changed',
    });
    const next = await googleFlow();
    const loggedIn = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: next.state, code: 'code2' })
      .set('Cookie', next.cookie)
      .expect(200);
    expect(loggedIn.body).toEqual(signedUp.body);
    expect(await source.query('select count(*)::int as count from workspaces')).toEqual([
      { count: 1 },
    ]);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: identity.email, password: input.password })
      .expect(401);
  });
  it('does not merge Google and password identities by email', async () => {
    await signup();
    jest.spyOn(google, 'exchange').mockResolvedValue({ ...identity, email: input.email });
    const flow = await googleFlow();
    const result = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: flow.state, code: 'code' })
      .set('Cookie', flow.cookie)
      .expect(409);
    expect(result.body.message).toContain('existing login method');
    expect(await source.query('select google_subject from users')).toEqual([
      { google_subject: null },
    ]);
    expect(await source.query('select count(*)::int as count from workspaces')).toEqual([
      { count: 1 },
    ]);
  });
  it('rejects mismatched, expired, replayed and missing state', async () => {
    const exchange = jest.spyOn(google, 'exchange').mockResolvedValue(identity);
    const flow = await googleFlow();
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: flow.state, code: 'code' })
      .expect(400);
    expect(exchange).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: flow.state, code: 'code' })
      .set('Cookie', flow.cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: flow.state, code: 'code' })
      .set('Cookie', flow.cookie)
      .expect(400);
    const expired = await googleFlow();
    await source.query("update google_auth_attempts set expires_at=now()-interval '1 second'");
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: expired.state, code: 'code' })
      .set('Cookie', expired.cookie)
      .expect(400);
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ code: 'code' })
      .expect(400);
  });
  it('handles Google consent denial, provider failure and deleted accounts without sessions', async () => {
    const flow = await googleFlow();
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: flow.state, error: 'access_denied' })
      .set('Cookie', flow.cookie)
      .expect(401);
    const exchange = jest
      .spyOn(google, 'exchange')
      .mockRejectedValueOnce(new UnauthorizedException('Google sign-in failed'));
    const failure = await googleFlow();
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: failure.state, code: 'code' })
      .set('Cookie', failure.cookie)
      .expect(401);
    expect(await source.query('select count(*)::int as count from auth_sessions')).toEqual([
      { count: 0 },
    ]);
    exchange.mockResolvedValue(identity);
    const success = await googleFlow();
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: success.state, code: 'code' })
      .set('Cookie', success.cookie)
      .expect(200);
    await source.query(
      "update users set deleted_at=now(), email=null, display_name='', avatar_url=null",
    );
    const deleted = await googleFlow();
    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ state: deleted.state, code: 'code' })
      .set('Cookie', deleted.cookie)
      .expect(401);
    expect(await source.query('select count(*)::int as count from auth_sessions')).toEqual([
      { count: 1 },
    ]);
  });
  it('enforces Google route limits with Retry-After', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      await request(app.getHttpServer()).get('/auth/google').expect(302);
      await request(app.getHttpServer()).get('/auth/google/callback').expect(400);
    }
    const start = await request(app.getHttpServer()).get('/auth/google').expect(429);
    const callback = await request(app.getHttpServer()).get('/auth/google/callback').expect(429);
    expect(Number(start.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(callback.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('keeps email authentication and health available when Google is disabled', async () => {
    const otherSource = testDataSource();
    await otherSource.initialize();
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot({ DATABASE_URL: testDatabaseUrl() })],
    })
      .overrideProvider(DataSource)
      .useValue(otherSource)
      .compile();
    const otherApp = module.createNestApplication({ logger: false });
    configureHttp(otherApp);
    try {
      await otherApp.listen(0, '127.0.0.1');
      await request(otherApp.getHttpServer()).get('/auth/google').expect(503);
      await request(otherApp.getHttpServer()).get('/auth/google/callback').expect(503);
      await request(otherApp.getHttpServer()).post('/auth/signup').send(input).expect(201);
      await request(otherApp.getHttpServer()).get('/health/ready').expect(200);
    } finally {
      await otherApp.close();
      if (otherSource.isInitialized) {
        await otherSource.destroy();
      }
    }
  });
});
