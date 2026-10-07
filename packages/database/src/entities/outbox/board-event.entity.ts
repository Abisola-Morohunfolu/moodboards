import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('board_events')
export class BoardEventEntity {
  @PrimaryGeneratedColumn('identity', { name: 'id', type: 'bigint', generatedIdentity: 'ALWAYS' })
  id!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ name: 'board_seq', type: 'bigint' })
  boardSeq!: string;

  @Column({ name: 'participant_id', type: 'uuid', nullable: true })
  participantId!: string | null;

  @Column({ name: 'type', type: 'text' })
  type!: string;

  @Column({ name: 'payload', type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'fanned_out_at', type: 'timestamptz', nullable: true })
  fannedOutAt!: Date | null;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt!: Date | null;
}
