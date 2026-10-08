import { MigrationInterface, QueryRunner } from 'typeorm';

export class ItemTrash1791417600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'CREATE INDEX items_trash ON items (board_id, deleted_at DESC, id) WHERE deleted_at IS NOT NULL',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX items_trash');
  }
}
