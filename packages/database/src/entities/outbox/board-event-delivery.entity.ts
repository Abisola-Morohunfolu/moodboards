import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('board_event_deliveries')
export class BoardEventDeliveryEntity {
  @PrimaryColumn({ name: 'event_id', type: 'bigint' })
  eventId!: string;

  @PrimaryColumn({ name: 'target', type: 'text' })
  target!: string;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'done_at', type: 'timestamptz', nullable: true })
  doneAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'lease_token', type: 'uuid', nullable: true })
  leaseToken!: string | null;

  @Column({ name: 'lease_until', type: 'timestamptz', nullable: true })
  leaseUntil!: Date | null;
}
