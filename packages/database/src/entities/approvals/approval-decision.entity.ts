import { Column, Entity, PrimaryColumn } from 'typeorm';
import { core_state } from '../types';

@Entity('approval_decisions')
export class ApprovalDecisionEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ name: 'participant_id', type: 'uuid' })
  participantId!: string;

  @Column({ name: 'status', type: 'text' })
  status!: 'approved' | 'rejected' | 'swap_requested';

  @Column({ name: 'comment', type: 'text', nullable: true })
  comment!: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', default: () => 'now()' })
  decidedAt!: Date;

  @Column({ name: 'item_version', type: 'integer', default: 1 })
  itemVersion!: number;

  @Column({ name: 'result_status', type: 'text', nullable: true })
  resultStatus!: 'pending' | 'approved' | 'rejected' | 'swap_requested' | null;

  @Column({
    name: 'result_core_state',
    type: 'enum',
    enum: core_state,
    enumName: 'core_state',
    nullable: true,
  })
  resultCoreState!: (typeof core_state)[number] | null;
}
