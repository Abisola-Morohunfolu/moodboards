import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('google_auth_attempts')
export class GoogleAuthAttemptEntity {
  @PrimaryColumn({ name: 'state_hash', type: 'text' })
  stateHash!: string;

  @Column({ name: 'nonce', type: 'text' })
  nonce!: string;

  @Column({ name: 'pkce_verifier', type: 'text' })
  pkceVerifier!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
