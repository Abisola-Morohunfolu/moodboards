# API

The NestJS HTTP API and WebSocket gateway. Feature folders own request handling
and business use cases; platform folders adapt external services.

Every board write must follow the transaction and outbox rules in
`docs/02-architecture.md`. Board routes resolve access before returning data,
and callers without a role receive 404.

Real database migrations begin in `src/database/migrations`; `db/schema.sql`
remains the reference model. It is not loaded by Compose. The initial migration
holds a fixed copy.

Run `pnpm dev:api` from the project root. The default address is
`http://127.0.0.1:3001`. The API validates configuration before it connects to
Postgres. It creates one connection pool and closes it on shutdown.

`GET /health/live` returns `200` while the API can handle requests.
`GET /health/ready` returns `200` when Postgres and migration checks pass.
Otherwise, it returns `503`. Each readiness request has a two-second deadline.
All checks share one connection. The deadline closes a stalled connection so
the pool can replace it on the next request.
Readiness does not create or change database objects.

## Accounts and workspaces

`AuthModule` installs a global session guard. New routes are private by default;
`@Public()` opens only explicit entrypoints. `@CurrentUser()` supplies a typed
principal; feature code still applies workspace and board authorization.

Signup, login, logout, Google auth, `/me`, and business workspace creation/listing
are implemented. POST bodies require JSON. Sessions use host-only HttpOnly cookies
and Postgres token hashes. Google configuration is optional as a complete set.
Rate limits use Redis via `REDIS_URL`; start both `postgres` and `redis` in Docker.
Limits return 429 with `Retry-After`. Redis failures return a generic 503 on
authentication entrypoints while existing sessions and logout keep using Postgres.
See [work unit 2](../../docs/13-backend-accounts-workspaces.md) for API contracts,
Google setup, migration behavior, tests, and deferred functionality.

## Boards, sections, and notes

Blank canvas boards work in personal and business workspaces. `GET /boards`
lists accessible boards with an existing account participant identity, and
`GET /workspaces/:id/boards` also discovers boards available through workspace
access. Board operations resolve current roles; a personal workspace owner has
no implicit access to restricted boards, while business owners retain recovery
access. Locked and archived boards are read-only.

Note creation is idempotent by client-generated UUID. Content edits require a
version; movement uses last write wins without changing that version. Every
mutation and its metadata-only event commit together. Section deletion returns
notes to Unsorted. Prices are omitted when the reader's role cannot see them.
PATCH and DELETE are available through credentialed CORS. POST, PATCH, and PUT
bodies require JSON; origin checks include bodyless DELETE.

See [work unit 3](../../docs/14-backend-board-core.md) for contracts, the transaction
diagram, and tests. Events remain undispatched until a later work unit; there
are no WebSockets, media jobs, starter kits, or archive/unarchive routes yet.
