import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('sections')
export class SectionEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'position', type: 'text' })
  position!: string;
}
