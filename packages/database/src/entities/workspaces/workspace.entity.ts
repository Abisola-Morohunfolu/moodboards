import { Column, Entity, PrimaryColumn } from 'typeorm';
import { workspace_type } from '../types';

@Entity('workspaces')
export class WorkspaceEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'type', type: 'enum', enum: workspace_type, enumName: 'workspace_type' })
  type!: (typeof workspace_type)[number];

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'logo_key', type: 'text', nullable: true })
  logoKey!: string | null;

  @Column({ name: 'brand_colour', type: 'text', nullable: true })
  brandColour!: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
