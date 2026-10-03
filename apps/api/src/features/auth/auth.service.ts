import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { withTransaction } from '@moodboard/database';
import { AccountResponse, LoginRequest, SignupRequest } from '@moodboard/contracts';
import { AuthRepository } from './auth.repository';
import { PasswordService } from './password.service';
import { SessionRepository } from './session.repository';
import { randomToken } from './cookies';
import { GoogleIdentity } from './google.service';
import { WorkspacesRepository } from '../workspaces/workspaces.repository';

@Injectable()
export class AuthService {
  constructor(
    private readonly source: DataSource,
    private readonly auth: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionRepository,
    private readonly workspaces: WorkspacesRepository,
  ) {}
  async account(
    userId: string,
    manager: EntityManager = this.source.manager,
  ): Promise<AccountResponse> {
    return {
      user: await this.auth.user(userId, manager),
      workspaces: await this.workspaces.list(userId, manager),
    };
  }
  async signup(input: SignupRequest): Promise<{ account: AccountResponse; token: string }> {
    const hash = await this.passwords.hash(input.password);
    try {
      return await withTransaction(this.source, async (manager) => {
        const id = await this.auth.provision(manager, input, hash, null);
        return this.signIn(manager, id);
      });
    } catch (error) {
      if (this.uniqueViolation(error)) {
        throw new ConflictException('Account already exists; use your existing login method');
      }
      throw error;
    }
  }
  async login(input: LoginRequest): Promise<{ account: AccountResponse; token: string }> {
    const user = await this.auth.credentials(input.email);
    const valid = await this.passwords.verify(input.password, user?.password_hash ?? null);
    if (!user || !valid || user.deleted_at) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return withTransaction(this.source, (manager) => this.signIn(manager, user.id));
  }
  async google(identity: GoogleIdentity): Promise<{ account: AccountResponse; token: string }> {
    try {
      return await withTransaction(this.source, async (manager) => {
        // Serialize callbacks for one Google identity, including first-time signup.
        await manager.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          identity.subject,
        ]);
        const existing = await this.auth.googleUser(manager, identity.subject);
        if (existing?.deleted_at) {
          throw new UnauthorizedException('Sign in required');
        }
        const id =
          existing?.id ??
          (await this.auth.provision(
            manager,
            { email: identity.email, displayName: identity.displayName },
            null,
            identity.subject,
            identity.avatarUrl,
          ));
        return this.signIn(manager, id);
      });
    } catch (error) {
      if (this.uniqueViolation(error)) {
        throw new ConflictException('Account already exists; use your existing login method');
      }
      throw error;
    }
  }
  private async signIn(
    manager: EntityManager,
    userId: string,
  ): Promise<{ account: AccountResponse; token: string }> {
    const account = await this.account(userId, manager);
    const token = randomToken();
    await this.sessions.create(manager, userId, token);
    return { account, token };
  }
  private uniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505'
    );
  }
}
