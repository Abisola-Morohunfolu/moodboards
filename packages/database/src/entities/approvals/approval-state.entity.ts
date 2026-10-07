import { Column, Entity, PrimaryColumn } from 'typeorm';
import { core_state } from '../types';

@Entity('approval_states')
export class ApprovalStateEntity {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId!: string;

  @Column({ name: 'status', type: 'text' })
  status!: 'pending' | 'approved' | 'rejected' | 'swap_requested';

  @Column({
    name: 'core_state',
    type: 'enum',
    enum: core_state,
    enumName: 'core_state',
    default: 'pending',
  })
  coreState!: (typeof core_state)[number];

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @Column({ name: 'item_version', type: 'integer', default: 1 })
  itemVersion!: number;
}
