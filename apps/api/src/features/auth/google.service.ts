import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { GoogleAttemptsRepository, GoogleAttempt } from './google-attempts.repository';
import { z } from 'zod';
import { emailSchema } from '@moodboard/contracts';
import { ApiConfig } from '../../config';
import { randomToken, tokenHash } from './cookies';

export interface GoogleIdentity {
  subject: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}
const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: emailSchema,
  email_verified: z.literal(true),
  nonce: z.string(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
});
@Injectable()
export class GoogleService {
  private oauthClient: OAuth2Client | undefined;
  constructor(
    private readonly attempts: GoogleAttemptsRepository,
    private readonly config: ConfigService<ApiConfig, true>,
  ) {}
  private client(): OAuth2Client {
    if (this.oauthClient) {
      return this.oauthClient;
    }
    const clientId = this.config.get('GOOGLE_CLIENT_ID', { infer: true });
    if (!clientId) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }
    this.oauthClient = new OAuth2Client({
      clientId,
      clientSecret: this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      redirectUri: this.config.get('GOOGLE_CALLBACK_URL', { infer: true }),
      // OAuth2Client supplies retry:true on individual requests. A zero retry
      // budget survives that override for both token exchange and certificate fetches.
      transporterOptions: { timeout: 5000, retryConfig: { retry: 0 } },
    });
    return this.oauthClient;
  }
  async start(): Promise<{ state: string; url: string }> {
    const client = this.client();
    const state = randomToken();
    const nonce = randomToken();
    const pkce = await client.generateCodeVerifierAsync();
    await this.attempts.create(tokenHash(state), nonce, pkce.codeVerifier);
    const url = client.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      nonce,
      code_challenge: pkce.codeChallenge!,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    return { state, url };
  }
  async consume(state: string | undefined, cookie: string | undefined): Promise<GoogleAttempt> {
    this.client();
    if (!state || !cookie || state !== cookie) {
      throw new BadRequestException('Invalid Google sign-in state');
    }
    const attempt = await this.attempts.consume(tokenHash(state));
    if (!attempt) {
      throw new BadRequestException('Invalid Google sign-in state');
    }
    return attempt;
  }
  async exchange(code: string, attempt: GoogleAttempt): Promise<GoogleIdentity> {
    const client = this.client();
    try {
      const { tokens } = await client.getToken({ code, codeVerifier: attempt.pkceVerifier });
      if (!tokens.id_token) {
        throw new Error('Missing identity');
      }
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.get('GOOGLE_CLIENT_ID', { infer: true })!,
      });
      const claims = claimsSchema.parse(ticket.getPayload());
      if (claims.nonce !== attempt.nonce) {
        throw new Error('Invalid nonce');
      }
      return {
        subject: claims.sub,
        email: claims.email,
        displayName: (claims.name?.trim() || claims.email.split('@')[0]!).slice(0, 100),
        avatarUrl: claims.picture ?? null,
      };
    } catch {
      // Never expose provider errors, authorization codes, or tokens.
      throw new UnauthorizedException('Google sign-in failed');
    }
  }
}
