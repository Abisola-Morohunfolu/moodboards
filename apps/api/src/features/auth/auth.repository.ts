import { randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SignupRequest, UserResponse } from '@moodboard/contracts';
import { UserEntity, WorkspaceEntity, WorkspaceMemberEntity } from '@moodboard/database';
import { userResponse } from './auth.mapper';

export type CredentialRow = Pick<UserEntity, 'id' | 'passwordHash' | 'deletedAt'>;
@Injectable()
export class AuthRepository {
  constructor(private readonly source: DataSource) {}
  async credentials(email: string): Promise<CredentialRow | undefined> {
    return (
      (await this.source.manager
        .createQueryBuilder(UserEntity, 'user')
        .select(['user.id', 'user.passwordHash', 'user.deletedAt'])
        .where('user.email = :email', { email })
        .getOne()) ?? undefined
    );
  }
  async googleUser(manager: EntityManager, subject: string): Promise<CredentialRow | undefined> {
    return (
      (await manager
        .createQueryBuilder(UserEntity, 'user')
        .select(['user.id', 'user.passwordHash', 'user.deletedAt'])
        .where('user.googleSubject = :subject', { subject })
        .getOne()) ?? undefined
    );
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
    await manager
      .createQueryBuilder()
      .insert()
      .into(UserEntity)
      .values({
        id,
        email: input.email,
        displayName: input.displayName,
        passwordHash,
        googleSubject,
        avatarUrl,
      })
      .execute();
    await manager
      .createQueryBuilder()
      .insert()
      .into(WorkspaceEntity)
      .values({ id: workspaceId, type: 'personal', name: 'Personal' })
      .execute();
    await manager
      .createQueryBuilder()
      .insert()
      .into(WorkspaceMemberEntity)
      .values({ workspaceId, userId: id, role: 'owner' })
      .execute();
    return id;
  }
  async user(userId: string, manager: EntityManager = this.source.manager): Promise<UserResponse> {
    const user = await manager
      .createQueryBuilder(UserEntity, 'user')
      .select(['user.id', 'user.email', 'user.displayName', 'user.avatarUrl', 'user.createdAt'])
      .where('user.id = :userId AND user.deletedAt IS NULL', { userId })
      .getOne();
    if (!user) {
      throw new UnauthorizedException('Sign in required');
    }
    return userResponse(user);
  }
}
