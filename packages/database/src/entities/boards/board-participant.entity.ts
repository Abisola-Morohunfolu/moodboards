import { Column, Entity, PrimaryColumn } from 'typeorm';
import { board_role } from '../types';

@Entity('board_participants')
export class BoardParticipantEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'role', type: 'enum', enum: board_role, enumName: 'board_role', nullable: true })
  role!: (typeof board_role)[number] | null;

  @Column({ name: 'invited_by', type: 'uuid', nullable: true })
  invitedBy!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoked_on_leave', type: 'boolean', default: false })
  revokedOnLeave!: boolean;

  @Column({ name: 'joined_at', type: 'timestamptz', default: () => 'now()' })
  joinedAt!: Date;

  @Column({ name: 'link_version', type: 'integer', default: 1 })
  linkVersion!: number;
}
