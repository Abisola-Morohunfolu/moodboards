import { Column, Entity, PrimaryColumn } from 'typeorm';
import { board_role, general_access } from '../types';

@Entity('boards')
export class BoardEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId!: string | null;

  @Column({ name: 'source_board_id', type: 'uuid', nullable: true })
  sourceBoardId!: string | null;

  @Column({ name: 'kit_id', type: 'text', default: 'blank' })
  kitId!: string;

  @Column({ name: 'title', type: 'text' })
  title!: string;

  @Column({ name: 'layout', type: 'text', default: 'canvas' })
  layout!: 'canvas' | 'grid';

  @Column({ name: 'currency', type: 'character', length: 3, nullable: true })
  currency!: string | null;

  @Column({
    name: 'general_access',
    type: 'enum',
    enum: general_access,
    enumName: 'general_access',
    default: 'restricted',
  })
  generalAccess!: (typeof general_access)[number];

  @Column({
    name: 'workspace_default_role',
    type: 'enum',
    enum: board_role,
    enumName: 'board_role',
    default: 'editor',
  })
  workspaceDefaultRole!: (typeof board_role)[number];

  @Column({
    name: 'link_role',
    type: 'enum',
    enum: board_role,
    enumName: 'board_role',
    default: 'viewer',
  })
  linkRole!: (typeof board_role)[number];

  @Column({
    name: 'show_prices_to',
    type: 'enum',
    enum: board_role,
    enumName: 'board_role',
    default: 'editor',
  })
  showPricesTo!: (typeof board_role)[number];

  @Column({ name: 'link_version', type: 'integer', default: 1 })
  linkVersion!: number;

  @Column({ name: 'event_seq', type: 'bigint', default: 0 })
  eventSeq!: string;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'upgraded_at', type: 'timestamptz', nullable: true })
  upgradedAt!: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
