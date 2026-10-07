import { Column, Entity, PrimaryColumn } from 'typeorm';
import { job_status } from '../types';

@Entity('assets')
export class AssetEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ name: 'storage_key', type: 'text' })
  storageKey!: string;

  @Column({ name: 'thumbnail_key', type: 'text', nullable: true })
  thumbnailKey!: string | null;

  @Column({ name: 'mime_type', type: 'text' })
  mimeType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @Column({ name: 'bytes', type: 'integer' })
  bytes!: number;

  @Column({ name: 'width', type: 'integer', nullable: true })
  width!: number | null;

  @Column({ name: 'height', type: 'integer', nullable: true })
  height!: number | null;

  @Column({ name: 'palette', type: 'text', array: true, nullable: true })
  palette!: string[] | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: job_status,
    enumName: 'job_status',
    default: 'pending',
  })
  status!: (typeof job_status)[number];

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
