import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('auth_sessions')
export class AuthSessionEntity {
  @PrimaryColumn({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
