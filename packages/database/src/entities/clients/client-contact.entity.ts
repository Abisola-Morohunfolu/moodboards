import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('client_contacts')
export class ClientContactEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'email', type: 'citext', nullable: true })
  email!: string | null;

  @Column({ name: 'link_version', type: 'integer', default: 1 })
  linkVersion!: number;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt!: Date | null;
}
