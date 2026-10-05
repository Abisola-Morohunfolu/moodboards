import { MigrationInterface, QueryRunner } from 'typeorm';
export class MediaDeliveryLeases1791158400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      'alter table board_event_deliveries add column lease_token uuid, add column lease_until timestamptz',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'alter table board_event_deliveries drop column lease_token, drop column lease_until',
    );
  }
}
