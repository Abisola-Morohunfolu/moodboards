import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountAuth1791072000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`alter table users add column password_hash text;
alter table users add column google_subject text unique;

create table auth_sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index auth_sessions_expiry on auth_sessions (expires_at);
create index auth_sessions_user on auth_sessions (user_id);

create table google_auth_attempts (
  state_hash text primary key,
  nonce text not null,
  pkce_verifier text not null,
  expires_at timestamptz not null
);
create index google_auth_attempts_expiry on google_auth_attempts (expires_at);

create table auth_rate_limits (
  key text primary key,
  count integer not null,
  expires_at timestamptz not null
);
create index auth_rate_limits_expiry on auth_rate_limits (expires_at);
`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      drop table auth_rate_limits;
      drop table google_auth_attempts;
      drop table auth_sessions;
      alter table users drop column google_subject;
      alter table users drop column password_hash;
    `);
  }
}
