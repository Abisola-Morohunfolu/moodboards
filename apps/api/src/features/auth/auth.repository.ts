import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SignupRequest, UserResponse } from '@moodboard/contracts';

export interface CredentialRow {
  id: string;
  password_hash: string | null;
  deleted_at: Date | null;
}
@Injectable()
export class AuthRepository {
  constructor(private readonly source: DataSource) {}
  async credentials(email: string): Promise<CredentialRow | undefined> {
    const [row] = await this.source.query<CredentialRow[]>(
      'select id, password_hash, deleted_at from users where email=$1',
      [email],
    );
    return row;
  }
  async googleUser(manager: EntityManager, subject: string): Promise<CredentialRow | undefined> {
    const [row] = await manager.query<CredentialRow[]>(
      'select id, password_hash, deleted_at from users where google_subject=$1',
      [subject],
    );
    return row;
  }
  async provision(
    manager: EntityManager,
    input: Pick<SignupRequest, 'email' | 'displayName'>,
    passwordHash: string | null,
    googleSubject: string | null,
    avatarUrl: string | null = null,
  ): Promise<string> {
    const id = randomUUID();
    const workspaceId = randomUUID();
    await manager.query(
      `insert into users (id, email, display_name, password_hash, google_subject, avatar_url)
      values ($1, $2, $3, $4, $5, $6)`,
      [id, input.email, input.displayName, passwordHash, googleSubject, avatarUrl],
    );
    await manager.query("insert into workspaces (id, type, name) values ($1, 'personal', $2)", [
      workspaceId,
      'Personal',
    ]);
    await manager.query(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
      [workspaceId, id],
    );
    return id;
  }
  async user(userId: string, manager: EntityManager = this.source.manager): Promise<UserResponse> {
    const [row] = await manager.query<UserResponse[]>(
      `select id, email, display_name as "displayName",
      avatar_url as "avatarUrl", to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
      from users where id=$1 and deleted_at is null`,
      [userId],
    );
    if (!row) {
      throw new UnauthorizedException('Sign in required');
    }
    return row;
  }
}
