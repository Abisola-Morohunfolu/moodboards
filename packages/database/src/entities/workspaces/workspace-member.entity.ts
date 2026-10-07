import { Column, Entity, PrimaryColumn } from 'typeorm';
import { member_role } from '../types';

@Entity('workspace_members')
export class WorkspaceMemberEntity {
  @PrimaryColumn({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'role', type: 'enum', enum: member_role, enumName: 'member_role' })
  role!: (typeof member_role)[number];
}
