-- Reference schema for Moodboard. Postgres 15+.
--
-- Rows that belong to a board point only at rows on the same board. Composite foreign keys on
-- (board_id, id) enforce this where both tables carry board_id. The API checks the rest.

create extension if not exists citext;

-- Enums

create type workspace_type  as enum ('business', 'personal');
create type member_role     as enum ('owner', 'staff', 'partner');
-- Declared lowest to highest, so SQL comparisons and max() follow rank.
create type board_role      as enum ('viewer', 'approver', 'editor', 'owner');
create type general_access  as enum ('restricted', 'workspace', 'link');
create type job_status      as enum ('pending', 'ready', 'failed');
create type purchase_status as enum ('pending', 'paid', 'refunded', 'failed');
create type core_state      as enum ('pending', 'approved', 'rejected');
create type reaction_kind   as enum ('love', 'maybe', 'no');
create type availability    as enum ('yes', 'if_needed', 'no');

-- Accounts and workspaces

-- Never deleted: items and decisions point at the user's participant rows.
-- Deleting an account sets deleted_at and clears the email, name, and avatar.
create table users (
  id           uuid primary key,
  email        citext unique,
  display_name text not null,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  password_hash text,
  google_subject text unique,
  constraint live_user_has_email check (deleted_at is not null or email is not null)
);

create table workspaces (
  id           uuid primary key,
  type         workspace_type not null,
  name         text not null,
  logo_key     text,
  brand_colour text,
  created_at   timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references users(id),
  role         member_role not null,
  primary key (workspace_id, user_id)
);
create index workspace_members_user on workspace_members (user_id);

-- Archived, never deleted, so boards and contacts keep their history.
create table clients (
  id           uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now(),
  archived_at  timestamptz,
  unique (workspace_id, id)
);

-- Contact-wide link_version is retained for schema compatibility.
-- Implemented board-specific links use board_participants.link_version.
-- Removing a contact clears name/email and revokes every assignment.
create table client_contacts (
  id           uuid primary key,
  client_id    uuid not null references clients(id) on delete cascade,
  name         text not null,
  email        citext,
  link_version int not null default 1,
  removed_at   timestamptz
);

-- Boards and access

-- Share link token = <board id>.HMAC(secret, id:link_version), so the current link can always be shown again.
create table boards (
  id                     uuid primary key,
  workspace_id           uuid not null references workspaces(id) on delete cascade,
  client_id              uuid,
  source_board_id        uuid references boards(id) on delete set null,
  kit_id                 text not null default 'blank',
  title                  text not null,
  layout                 text not null default 'canvas' check (layout in ('canvas', 'grid')),
  currency               char(3),
  general_access         general_access not null default 'restricted',
  workspace_default_role board_role not null default 'editor',
  link_role              board_role not null default 'viewer',
  show_prices_to         board_role not null default 'editor',
  link_version           int not null default 1,
  -- Last board_events.board_seq issued. Incrementing it locks the board row until commit,
  -- so a board's events commit in seq order with no gaps.
  event_seq              bigint not null default 0,
  locked_at              timestamptz,
  upgraded_at            timestamptz,
  archived_at            timestamptz,
  created_by             uuid not null references users(id),
  created_at             timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, client_id) references clients (workspace_id, id),
  constraint link_role_safe check (link_role in ('viewer', 'approver')),
  constraint workspace_role_not_owner check (workspace_default_role <> 'owner'),
  constraint editors_see_prices check (show_prices_to <> 'owner')
);
create index boards_workspace on boards (workspace_id) where archived_at is null;

create table invites (
  id             uuid primary key,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  board_id       uuid,
  invited_by     uuid not null references users(id),
  email          citext not null,
  workspace_role member_role,
  board_role     board_role,
  token_hash     text unique not null,
  expires_at     timestamptz not null,
  accepted_at    timestamptz,
  accepted_by    uuid references users(id),
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  foreign key (workspace_id, board_id) references boards (workspace_id, id) on delete cascade on update cascade,
  constraint invite_grants_something check (workspace_role is not null or board_role is not null),
  constraint board_role_needs_board  check (board_role is null or board_id is not null),
  constraint no_owner_invites        check (workspace_role is distinct from 'owner' and board_role is distinct from 'owner'),
  constraint accepted_pair           check ((accepted_at is null) = (accepted_by is null))
);
-- One open invite per person per workspace, and per board for board invites. Re-inviting replaces it.
create unique index invites_one_open on invites (workspace_id, board_id, email) nulls not distinct
  where accepted_at is null and revoked_at is null;

-- role null: the person got in through general access or the business owner rule.
-- The row records who acted and grants nothing itself.
-- user_id and contact_id are both set after a client contact signs up.
create table board_participants (
  id         uuid primary key,
  board_id   uuid not null references boards(id) on delete cascade,
  user_id    uuid references users(id),
  contact_id uuid references client_contacts(id),
  role       board_role,
  invited_by uuid references users(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  -- Set when the revocation came from leaving the workspace, so rejoining can undo only those.
  -- A manual revoke or an accepted invite clears it.
  revoked_on_leave boolean not null default false,
  joined_at  timestamptz not null default now(),
  link_version integer not null default 1,
  constraint participant_link_positive check (link_version > 0),
  unique (board_id, id),
  constraint has_identity check (user_id is not null or contact_id is not null)
);
create unique index board_participants_user    on board_participants (board_id, user_id)    where user_id is not null;
create unique index board_participants_contact on board_participants (board_id, contact_id) where contact_id is not null;
create index board_participants_by_user on board_participants (user_id) where user_id is not null;

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

create table board_modules (
  board_id  uuid not null references boards(id) on delete cascade,
  module_id text not null,
  config    jsonb not null default '{}',
  enabled   boolean not null default true,
  primary key (board_id, module_id)
);

-- Content

create table sections (
  id       uuid primary key,
  board_id uuid not null references boards(id) on delete cascade,
  name     text not null,
  position text not null,
  unique (board_id, id)
);

create table link_previews (
  id          uuid primary key,
  url         text not null,
  url_hash    bytea unique not null,
  title       text,
  description text,
  image_url   text,
  site_name   text,
  status      job_status not null default 'pending',
  fetched_at  timestamptz,
  expires_at  timestamptz
);

create table assets (
  id            uuid primary key,
  board_id      uuid not null references boards(id) on delete cascade,
  storage_key   text not null,
  thumbnail_key text,
  mime_type     text not null,
  bytes         int not null,
  width         int,
  height        int,
  palette       text[],
  status        job_status not null default 'pending',
  created_at    timestamptz not null default now(),
  unique (board_id, id)
);
-- Copied items get their own asset row on the target board; the stored objects are shared.
-- Storage cleanup deletes an object only when no asset row references it as storage_key or thumbnail_key.
create index assets_storage_key on assets (storage_key);
create index assets_thumbnail_key on assets (thumbnail_key) where thumbnail_key is not null;

create table items (
  id                  uuid primary key,
  board_id            uuid not null references boards(id) on delete cascade,
  section_id          uuid,
  created_by          uuid not null,
  copied_from_item_id uuid references items(id) on delete set null,
  kind                text not null,
  title               text,
  note                text,
  x                   real,
  y                   real,
  width               real,
  height              real,
  rotation            real not null default 0,
  z_order             text not null,
  asset_id            uuid,
  link_preview_id     uuid references link_previews(id),
  price_cents         int check (price_cents >= 0),
  quantity            int not null default 1 check (quantity > 0),
  attributes          jsonb not null default '{}',
  -- Guards content fields only. Position fields (x, y, z_order, section_id) are last write wins.
  version             int not null default 1,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (board_id, id),
  foreign key (board_id, section_id) references sections (board_id, id) on delete set null (section_id),
  foreign key (board_id, created_by) references board_participants (board_id, id),
  foreign key (board_id, asset_id)   references assets (board_id, id)
);
create index items_board on items (board_id) where deleted_at is null;
create index items_link_preview on items (link_preview_id) where link_preview_id is not null and deleted_at is null;
create index items_asset on items (asset_id) where asset_id is not null;

-- Event outbox

-- board_seq comes from boards.event_seq in the same transaction. Clients catch up by board_seq.
-- fanned_out_at: delivery rows exist. dispatched_at: every delivery is done or failed.
create table board_events (
  id             bigint generated always as identity primary key,
  board_id       uuid not null references boards(id) on delete cascade,
  board_seq      bigint not null,
  participant_id uuid references board_participants(id),
  type           text not null,
  payload        jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  fanned_out_at  timestamptz,
  dispatched_at  timestamptz
);
create index board_events_unfanned on board_events (id) where fanned_out_at is null;
create unique index board_events_board_seq on board_events (board_id, board_seq);

-- One row per event per target (a module id or a job queue). Each target retries alone.
-- After 10 attempts the row gets failed_at and stops retrying.
create table board_event_deliveries (
  event_id        bigint not null references board_events(id) on delete cascade,
  target          text not null,
  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  done_at         timestamptz,
  failed_at       timestamptz,
  lease_token     uuid,
  lease_until     timestamptz,
  primary key (event_id, target)
);
create index board_event_deliveries_due on board_event_deliveries (next_attempt_at)
  where done_at is null and failed_at is null;

create function notify_board_event() returns trigger language plpgsql as $$
begin
  perform pg_notify('board_events', new.id::text);
  return new;
end;
$$;

create trigger board_events_notify after insert on board_events
  for each row execute function notify_board_event();

-- Billing

create table subscriptions (
  workspace_id           uuid primary key references workspaces(id) on delete cascade,
  stripe_customer_id     text unique not null,
  stripe_subscription_id text unique not null,
  plan                   text not null check (plan in ('business', 'household')),
  status                 text not null,
  current_period_end     timestamptz
);

-- A payment record outlives its board: deleting the workspace clears board_id.
create table purchases (
  id                       uuid primary key,
  board_id                 uuid references boards(id) on delete set null,
  buyer_id                 uuid not null references users(id),
  product                  text not null,
  amount_cents             int not null,
  currency                 char(3) not null,
  stripe_session_id        text unique not null,
  stripe_payment_intent_id text unique,
  status                   purchase_status not null default 'pending',
  created_at               timestamptz not null default now(),
  paid_at                  timestamptz
);

-- A row exists only for a processed event: the handler inserts it in the same transaction
-- as the grant. A Stripe retry that conflicts on id is skipped.
create table stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

-- Module: approvals

-- An item with no row is pending. A decision upserts the row and locks it with FOR UPDATE
-- before it reads decisions, so concurrent decisions on one item run one at a time.
create table approval_states (
  item_id    uuid primary key references items(id) on delete cascade,
  status     text not null,
  core_state core_state not null default 'pending',
  updated_at timestamptz not null default now()
);

create table approval_decisions (
  id             uuid primary key,
  item_id        uuid not null references items(id) on delete cascade,
  participant_id uuid not null references board_participants(id),
  status         text not null,
  comment        text,
  decided_at     timestamptz not null default now()
);
-- The rule reads each decider's latest decision.
create index approval_decisions_latest on approval_decisions (item_id, participant_id, decided_at desc);

-- Module: budget

create table budget_allocations (
  id           uuid primary key,
  board_id     uuid not null references boards(id) on delete cascade,
  section_id   uuid,
  amount_cents int not null check (amount_cents >= 0),
  foreign key (board_id, section_id) references sections (board_id, id) on delete cascade
);
create unique index budget_one_per_scope on budget_allocations (board_id, section_id) nulls not distinct;

-- Module: vendors

create table vendors (
  id           uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  category     text,
  website      text,
  email        text
);

create table item_vendors (
  item_id   uuid primary key references items(id) on delete cascade,
  vendor_id uuid not null references vendors(id) on delete cascade
);

-- Module: checklist

create table checklist_tasks (
  id          uuid primary key,
  board_id    uuid not null references boards(id) on delete cascade,
  item_id     uuid,
  assignee_id uuid,
  title       text not null,
  due_on      date,
  position    text not null,
  done_at     timestamptz,
  -- Soft delete keeps source_key taken, so a deleted starter task is never seeded again.
  deleted_at  timestamptz,
  -- Set on tasks the module creates itself, e.g. 'seed:pack-kitchen' or 'deposit:<item id>'.
  -- A redelivered event or a repeat approval adds no duplicate.
  source_key  text,
  unique (board_id, source_key),
  foreign key (board_id, item_id)     references items (board_id, id) on delete set null (item_id),
  foreign key (board_id, assignee_id) references board_participants (board_id, id) on delete set null (assignee_id)
);

-- Module: compare

create table compare_scores (
  item_id        uuid references items(id) on delete cascade,
  participant_id uuid references board_participants(id) on delete cascade,
  criterion      text not null,
  score          smallint not null check (score between 1 and 5),
  primary key (item_id, participant_id, criterion)
);

-- Module: date poll

create table date_poll_options (
  id        uuid primary key,
  board_id  uuid not null references boards(id) on delete cascade,
  label     text,
  starts_at timestamptz not null,
  ends_at   timestamptz
);

create table date_poll_votes (
  option_id      uuid references date_poll_options(id) on delete cascade,
  participant_id uuid references board_participants(id) on delete cascade,
  answer         availability not null,
  primary key (option_id, participant_id)
);

-- Module: reactions

create table reactions (
  item_id        uuid references items(id) on delete cascade,
  participant_id uuid references board_participants(id) on delete cascade,
  kind           reaction_kind not null,
  primary key (item_id, participant_id)
);

-- Authentication runtime state

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
