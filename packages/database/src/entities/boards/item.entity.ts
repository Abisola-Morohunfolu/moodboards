import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('items')
export class ItemEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ name: 'section_id', type: 'uuid', nullable: true })
  sectionId!: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'copied_from_item_id', type: 'uuid', nullable: true })
  copiedFromItemId!: string | null;

  @Column({ name: 'kind', type: 'text' })
  kind!: 'note' | 'image' | 'link';

  @Column({ name: 'title', type: 'text', nullable: true })
  title!: string | null;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'x', type: 'real', nullable: true })
  x!: number | null;

  @Column({ name: 'y', type: 'real', nullable: true })
  y!: number | null;

  @Column({ name: 'width', type: 'real', nullable: true })
  width!: number | null;

  @Column({ name: 'height', type: 'real', nullable: true })
  height!: number | null;

  @Column({ name: 'rotation', type: 'real', default: 0 })
  rotation!: number;

  @Column({ name: 'z_order', type: 'text' })
  zOrder!: string;

  @Column({ name: 'asset_id', type: 'uuid', nullable: true })
  assetId!: string | null;

  @Column({ name: 'link_preview_id', type: 'uuid', nullable: true })
  linkPreviewId!: string | null;

  @Column({ name: 'price_cents', type: 'integer', nullable: true })
  priceCents!: number | null;

  @Column({ name: 'quantity', type: 'integer', default: 1 })
  quantity!: number;

  @Column({ name: 'attributes', type: 'jsonb', default: () => "'{}'::jsonb" })
  attributes!: Record<string, unknown>;

  @Column({ name: 'version', type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
