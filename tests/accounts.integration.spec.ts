import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AuthRepository } from '../apps/api/src/features/auth/auth.repository';
import { AuthService } from '../apps/api/src/features/auth/auth.service';
import { GoogleAttemptsRepository } from '../apps/api/src/features/auth/google-attempts.repository';
import { GoogleService } from '../apps/api/src/features/auth/google.service';
import { PasswordService } from '../apps/api/src/features/auth/password.service';
import { tokenHash } from '../apps/api/src/features/auth/cookies';
import { SessionRepository } from '../apps/api/src/features/auth/session.repository';
import { WorkspacesRepository } from '../apps/api/src/features/workspaces/workspaces.repository';
import { validateEnvironment } from '../apps/api/src/config';
import { testDatabaseUrl, testDataSource } from './database';

describe('Atomic account onboarding and shared auth state', () => {
  const source = testDataSource(5);
  const repository = new AuthRepository(source);
  const passwords = new PasswordService();
  const sessions = new SessionRepository(source);
  const workspaces = new WorkspacesRepository(source);
  const auth = new AuthService(source, repository, passwords, sessions, workspaces);
  const configuration = validateEnvironment({
    DATABASE_URL: testDatabaseUrl(),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_CALLBACK_URL: 'http://127.0.0.1:3001/auth/google/callback',
  });
  const config = {
    get: (key: keyof typeof configuration) => configuration[key],
  } as ConstructorParameters<typeof GoogleService>[1];
  const input = {
    email: 'planner@example.com',
    displayName: 'Planner',
    password: 'correct horse battery staple',
  };
  beforeAll(async () => {
    await source.initialize();
    await source.runMigrations();
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
    await source.destroy();
  });
  it('identity-checked support recovery replaces the password and revokes sessions', async () => {
    const signed = await auth.signup(input);
    const second = await auth.login(input);
    const run = (verified: boolean) =>
      new Promise<number | null>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            'apps/api/dist/features/auth/support.cli.js',
            'reset-password',
            input.email,
            ...(verified ? ['--identity-verified'] : []),
          ],
          {
            env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
            stdio: ['pipe', 'ignore', 'inherit'],
          },
        );
        child.on('error', reject);
        child.on('close', resolve);
        child.stdin.end('replacement password for beta');
      });
    expect(await run(false)).toBe(1);
    expect(await sessions.resolve(signed.token)).toBeDefined();
    expect(await run(true)).toBe(0);
    expect(await sessions.resolve(signed.token)).toBeUndefined();
    expect(await sessions.resolve(second.token)).toBeUndefined();
    await expect(auth.login(input)).rejects.toThrow('Invalid email or password');
    await expect(
      auth.login({ ...input, password: 'replacement password for beta' }),
    ).resolves.toHaveProperty('token');
  });
  it('does not issue an old-password session when recovery finishes during verification', async () => {
    const signed = await auth.signup(input);
    const replacement = await passwords.hash('replacement password for beta');
    const originalVerify = passwords.verify.bind(passwords);
    let verified!: () => void;
    let resume!: () => void;
    const reached = new Promise<void>((resolve) => {
      verified = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    jest.spyOn(passwords, 'verify').mockImplementation(async (password, hash) => {
      const valid = await originalVerify(password, hash);
      verified();
      await resumed;
      return valid;
    });
    const login = auth.login(input);
    await reached;
    try {
      await source.transaction(async (manager) => {
        await manager.query('update users set password_hash = $1 where id = $2', [
          replacement,
          signed.account.user.id,
        ]);
        await manager.query('delete from auth_sessions where user_id = $1', [
          signed.account.user.id,
        ]);
      });
    } finally {
      resume();
    }
    await expect(login).rejects.toThrow('Invalid email or password');
    expect(await source.query('select count(*)::int as count from auth_sessions')).toEqual([
      { count: 0 },
    ]);
  });
  it('rolls back the entire signup when session creation fails', async () => {
    jest.spyOn(sessions, 'create').mockRejectedValueOnce(new Error('injected failure'));
    await expect(auth.signup(input)).rejects.toThrow('injected failure');
    expect(await source.query('select count(*)::int as count from users')).toEqual([{ count: 0 }]);
    expect(await source.query('select count(*)::int as count from workspaces')).toEqual([
      { count: 0 },
    ]);
    expect(await source.query('select count(*)::int as count from workspace_members')).toEqual([
      { count: 0 },
    ]);
  });
  it('concurrent password signups create one complete account', async () => {
    const results = await Promise.allSettled([
      auth.signup(input),
      auth.signup({ ...input, email: 'PLANNER@EXAMPLE.COM' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason.getStatus()).toBe(409);
    for (const table of ['users', 'workspaces', 'workspace_members', 'auth_sessions']) {
      expect(await source.query(`select count(*)::int as count from ${table}`)).toEqual([
        { count: 1 },
      ]);
    }
  });
  it('concurrent Google signups share one account and personal workspace', async () => {
    const identity = {
      subject: 'google-1',
      email: input.email,
      displayName: 'Planner',
      avatarUrl: null,
    };
    const results = await Promise.all([auth.google(identity), auth.google(identity)]);
    expect(results[0]!.account.user.id).toBe(results[1]!.account.user.id);
    expect(results[0]!.token).not.toBe(results[1]!.token);
    expect(await source.query('select count(*)::int as count from workspaces')).toEqual([
      { count: 1 },
    ]);
    expect(await source.query('select password_hash from users')).toEqual([
      { password_hash: null },
    ]);
  });
  it('rolls back workspace creation for a missing member', async () => {
    await expect(workspaces.create(randomUUID(), 'Team')).rejects.toThrow();
    expect(await source.query('select count(*)::int as count from workspaces')).toEqual([
      { count: 0 },
    ]);
  });
  it('two API instances consume OAuth state exactly once', async () => {
    const first = new GoogleService(new GoogleAttemptsRepository(source), config);
    const second = new GoogleService(new GoogleAttemptsRepository(source), config);
    const { state } = await first.start();
    const results = await Promise.allSettled([
      first.consume(state, state),
      second.consume(state, state),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await source.query('select count(*)::int as count from google_auth_attempts')).toEqual([
      { count: 0 },
    ]);
  });
  it('cleans expired OAuth state when starting a new Google flow', async () => {
    await source.query(
      "insert into google_auth_attempts values ('expired', 'nonce', 'verifier', now()-interval '1 second')",
    );
    const { state } = await new GoogleService(new GoogleAttemptsRepository(source), config).start();
    expect(await source.query('select state_hash from google_auth_attempts')).toEqual([
      { state_hash: tokenHash(state) },
    ]);
  });
});
