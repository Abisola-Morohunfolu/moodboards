import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../../config';
import { GoogleService } from './google.service';

const configuration = validateEnvironment({
  DATABASE_URL: 'postgres://a:b@localhost/moodboard_test',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'http://127.0.0.1:3001/auth/google/callback',
});
describe('Google identity adapter', () => {
  const query = jest.fn();
  const service = new GoogleService(
    { query } as unknown as DataSource,
    new ConfigService(configuration),
  );
  const claims = {
    sub: 'google-user',
    email: 'Ada@Example.com',
    email_verified: true,
    nonce: 'nonce',
    name: ' Ada ',
  };
  beforeEach(() => {
    query.mockReset();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('requests only identity scopes and S256 PKCE', async () => {
    const result = await service.start();
    const url = new URL(result.url);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(result.state);
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('insert into google_auth_attempts'),
      [expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(String), expect.any(String)],
    );
  });
  it('uses the official verifier with the configured audience', async () => {
    const exchange = jest
      .spyOn(OAuth2Client.prototype, 'getToken')
      .mockResolvedValue({ tokens: { id_token: 'id-token' } } as never);
    const verify = jest
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockResolvedValue({ getPayload: () => claims } as never);
    expect(await service.exchange('code', { nonce: 'nonce', pkce_verifier: 'verifier' })).toEqual({
      subject: 'google-user',
      email: 'ada@example.com',
      displayName: 'Ada',
      avatarUrl: null,
    });
    expect(exchange).toHaveBeenCalledWith({ code: 'code', codeVerifier: 'verifier' });
    expect(verify).toHaveBeenCalledWith({ idToken: 'id-token', audience: 'client-id' });
  });
  it.each(['token', 'certificates'] as const)(
    'does not retry failed %s requests through the real Google transport',
    async (endpoint) => {
      // Capture the client without replacing its request or retry machinery.
      const generateAuthUrl = jest.spyOn(OAuth2Client.prototype, 'generateAuthUrl');
      const adapter = new GoogleService(
        { query } as unknown as DataSource,
        new ConfigService(configuration),
      );
      await adapter.start();
      const client = generateAuthUrl.mock.contexts[0] as OAuth2Client;
      const transport = client.transporter;
      const provider = jest.fn(async () => new Response('{}', { status: 503 }));
      transport.defaults.fetchImplementation = provider;
      if (endpoint === 'token') {
        await expect(
          adapter.exchange('code', { nonce: 'nonce', pkce_verifier: 'verifier' }),
        ).rejects.toThrow('Google sign-in failed');
      } else {
        await expect(client.getFederatedSignonCertsAsync()).rejects.toThrow();
      }
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { ...claims, nonce: 'wrong' },
    { ...claims, email_verified: false },
    { ...claims, sub: '' },
    { ...claims, email: 'bad' },
  ])('rejects invalid identity claims', async (payload) => {
    jest
      .spyOn(OAuth2Client.prototype, 'getToken')
      .mockResolvedValue({ tokens: { id_token: 'token' } } as never);
    jest
      .spyOn(OAuth2Client.prototype, 'verifyIdToken')
      .mockResolvedValue({ getPayload: () => payload } as never);
    await expect(
      service.exchange('code', { nonce: 'nonce', pkce_verifier: 'verifier' }),
    ).rejects.toThrow('Google sign-in failed');
  });
  it.each(['signature', 'issuer', 'audience', 'expiry'])(
    'rejects verification failures without exposing provider details: %s',
    async (reason) => {
      jest
        .spyOn(OAuth2Client.prototype, 'getToken')
        .mockResolvedValue({ tokens: { id_token: 'token' } } as never);
      jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockImplementation(async () => {
        throw new Error(`private token ${reason}`);
      });
      await expect(
        service.exchange('code', { nonce: 'nonce', pkce_verifier: 'verifier' }),
      ).rejects.toThrow('Google sign-in failed');
    },
  );
  it('handles provider failures and missing identity tokens', async () => {
    const exchange = jest
      .spyOn(OAuth2Client.prototype, 'getToken')
      .mockImplementationOnce(async () => {
        throw new Error('private secret');
      });
    await expect(service.exchange('code', { nonce: 'nonce', pkce_verifier: 'v' })).rejects.toThrow(
      'Google sign-in failed',
    );
    exchange.mockResolvedValue({ tokens: { access_token: 'discard' } } as never);
    await expect(service.exchange('code', { nonce: 'nonce', pkce_verifier: 'v' })).rejects.toThrow(
      'Google sign-in failed',
    );
  });
  it('rejects state mismatch before consuming database state', async () => {
    await expect(service.consume('one', 'two')).rejects.toThrow('Invalid Google sign-in state');
    expect(query).not.toHaveBeenCalled();
  });
  it('rejects already consumed attempts', async () => {
    query.mockResolvedValue([[], 0]);
    await expect(service.consume('same', 'same')).rejects.toThrow('Invalid Google sign-in state');
  });
});
