import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientAccess1791244800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      alter table board_participants add column link_version integer not null default 1;
      alter table board_participants add constraint participant_link_positive check (link_version > 0);
      create table contact_sessions (
        token_hash text primary key,
        participant_id uuid not null,
        contact_id uuid not null references client_contacts(id),
        board_id uuid not null references boards(id) on delete cascade,
        link_version integer not null,
        secret_fingerprint text not null,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null,
        foreign key (board_id, participant_id) references board_participants(board_id, id) on delete cascade
      );
      create index contact_sessions_expiry on contact_sessions(expires_at);
      create index contact_sessions_contact on contact_sessions(contact_id);
      create index contact_sessions_participant on contact_sessions(participant_id);
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`drop table contact_sessions;
      alter table board_participants drop constraint participant_link_positive;
      alter table board_participants drop column link_version;`);
  }
}
