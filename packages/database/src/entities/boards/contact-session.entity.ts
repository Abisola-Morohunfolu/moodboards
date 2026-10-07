import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('contact_sessions')
export class ContactSessionEntity {
  @PrimaryColumn({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'participant_id', type: 'uuid' })
  participantId!: string;

  @Column({ name: 'contact_id', type: 'uuid' })
  contactId!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ name: 'link_version', type: 'integer' })
  linkVersion!: number;

  @Column({ name: 'secret_fingerprint', type: 'text' })
  secretFingerprint!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
