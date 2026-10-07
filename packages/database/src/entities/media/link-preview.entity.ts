import { Column, Entity, PrimaryColumn } from 'typeorm';
import { job_status } from '../types';

@Entity('link_previews')
export class LinkPreviewEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'url', type: 'text' })
  url!: string;

  @Column({ name: 'url_hash', type: 'bytea' })
  urlHash!: Buffer;

  @Column({ name: 'title', type: 'text', nullable: true })
  title!: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl!: string | null;

  @Column({ name: 'site_name', type: 'text', nullable: true })
  siteName!: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: job_status,
    enumName: 'job_status',
    default: 'pending',
  })
  status!: (typeof job_status)[number];

  @Column({ name: 'fetched_at', type: 'timestamptz', nullable: true })
  fetchedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
}
