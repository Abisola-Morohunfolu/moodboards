# Moodboard

A shared mood board that turns inspiration into an agreed plan. Planners and designers use it to get client sign-off. Couples and households use it to plan weddings, moves, house hunts, and dates together.

"Moodboard" is a working name.

## Read in this order

| File | What it covers |
|------|----------------|
| [docs/01-product.md](docs/01-product.md) | Audiences, problem, positioning, pricing, validation plan |
| [docs/02-architecture.md](docs/02-architecture.md) | Stack, runtime components, event outbox, realtime, jobs |
| [docs/03-data-model.md](docs/03-data-model.md) | Every table, how they connect, design rules |
| [db/schema.sql](db/schema.sql) | Reference Postgres DDL for the whole model |
| [docs/04-modules-and-kits.md](docs/04-modules-and-kits.md) | Module system, module catalogue, kits |
| [docs/05-access-control.md](docs/05-access-control.md) | Roles, sharing, role resolution, revocation |
| [docs/06-flows.md](docs/06-flows.md) | Nine end-to-end flows as sequence diagrams |
| [docs/07-api.md](docs/07-api.md) | HTTP and WebSocket surface with required permissions |
| [docs/08-design.md](docs/08-design.md) | Screens, type, colour, UI rules |
| [docs/09-roadmap.md](docs/09-roadmap.md) | Build order and milestones |
| [docs/10-decisions.md](docs/10-decisions.md) | Decision log with reasons |
| [docs/11-project-structure.md](docs/11-project-structure.md) | Monorepo folders and dependency boundaries |
| [docs/12-backend-foundation.md](docs/12-backend-foundation.md) | Backend foundation and test gates |
| [docs/13-backend-accounts-workspaces.md](docs/13-backend-accounts-workspaces.md) | Accounts, cookie sessions, Google login, and workspaces |
| [docs/14-backend-board-core.md](docs/14-backend-board-core.md) | Blank boards, sections, notes, permissions, and atomic event writes |
| [docs/15-backend-media-workers.md](docs/15-backend-media-workers.md) | Image uploads, shared link previews, durable jobs, and media maintenance |
| [docs/16-backend-client-access.md](docs/16-backend-client-access.md) | Clients, board-specific contact links, isolated client sessions, and revocation |
| [docs/17-web-planner-client-ui.md](docs/17-web-planner-client-ui.md) | Planner and client UI, local web setup, and browser flow diagrams |
| [docs/18-backend-approvals.md](docs/18-backend-approvals.md) | Client decisions, swap requests, and approval state rules |

## Local development

Use Node.js 24 and pnpm 10.33.0. The backend includes account authentication,
workspace onboarding, blank canvas boards, sections, and note items, with shared
database and contract packages. Business clients and contacts have board-specific
links and isolated read sessions. The worker processes media jobs. The React web
app provides planner boards, client management, and a mobile client viewer.
The API also supports client approvals and swap requests; web controls follow.

Start Docker. Then run these commands from the project root:

```bash
cp .env.example .env
# Configure the four R2_* fields for media; see docs/15-backend-media-workers.md.
pnpm install --frozen-lockfile
docker compose up -d --wait postgres redis
pnpm db:migrate
pnpm dev:api
pnpm dev:web
```

| Service | Address | Use |
|---------|---------|-----|
| Postgres 15 | `localhost:5432` | Uses explicit TypeORM migrations |
| Redis 7 | `127.0.0.1:6379` | Authentication rate limits and BullMQ jobs, with eviction off |
| Cloudflare R2 | Managed cloud bucket | Private media storage; configure credentials before starting the worker |
| Mailpit | SMTP `localhost:1025`, inbox `localhost:8025` | Catches every email |
| Stripe CLI | opt-in: `docker compose --profile stripe up -d` | Forwards test webhooks to `localhost:3001/webhooks/stripe` |

Check `http://127.0.0.1:3001/health/live` and
`http://127.0.0.1:3001/health/ready`. Both routes return `200` after migration.
Use `pnpm db:status` to check migration records. This command fails if a migration
is pending. Use `pnpm start:api` to run the last build without a file watcher.

The database now uses the `postgres-migrations-data` volume. The old
`postgres-data` volume and its data remain available. Do not delete volumes to
apply a schema change. Add a migration and run `pnpm db:migrate`.

To start the other backing services, run `docker compose up -d --wait mailpit`.

## Account onboarding

All routes are private by default. Signup, login, Google auth, and health are
explicitly public. Signup creates a personal workspace; signed-in users can
create a business workspace with `POST /workspaces` and read `/me` or `/workspaces`.

Use JSON POST bodies. Sessions use an HttpOnly cookie and expire after seven
days. For a local password smoke test:

```bash
curl -sS -c /tmp/moodboard-cookies.txt -H 'Content-Type: application/json' \
  -d '{"email":"planner@example.com","password":"correct horse battery staple","displayName":"Planner"}' \
  http://127.0.0.1:3001/auth/signup
curl -sS -b /tmp/moodboard-cookies.txt http://127.0.0.1:3001/me
```

Google sign-in is disabled until all three Google variables are configured.
Authentication rate limits use `REDIS_URL`. Exceeded limits return 429 with
`Retry-After`; unavailable Redis returns 503 on signup, login, and Google routes.
Existing Postgres sessions and logout continue working during a Redis outage.
See [Google setup and the manual smoke test](docs/13-backend-accounts-workspaces.md).
Account linking, password reset, and local email verification are deferred.

## Backend tests

Use separate Postgres, Redis, and MinIO test services with temporary storage.
These commands do not use the development stores:

```bash
pnpm db:test:start
export TEST_DATABASE_URL=postgres://moodboard_test:moodboard_test@127.0.0.1:5433/moodboard_test
export TEST_REDIS_URL=redis://127.0.0.1:6380/15
export TEST_STORAGE_ENDPOINT=http://127.0.0.1:9002
export TEST_STORAGE_BUCKET=moodboard-test-assets
pnpm check
pnpm db:test:stop
```

You must export `TEST_DATABASE_URL`. Tests do not read it from `.env` and do not
use `DATABASE_URL` as a fallback. Tests require the database name `moodboard_test`.
Use `TEST_POSTGRES_PORT` to change the test service port. Change the test URL too.
Export `TEST_REDIS_URL` as well. Redis tests require database 15 on the disposable
service and never fall back to `REDIS_URL`. `TEST_REDIS_PORT` changes its port.

Run `pnpm test:unit`, `pnpm test:integration`, or `pnpm test:e2e` for one test group.
Database test groups run in sequence. Do not run them against the same database
at the same time. CI uses separate Postgres 15 and Redis 7 services and runs `pnpm check`.

See [foundation test gates](docs/12-backend-foundation.md) and
[board core contracts and concurrency tests](docs/14-backend-board-core.md).

## Board core

Use the session cookie from signup or login to create a board in one of your
workspaces. `POST /boards` accepts `workspaceId` and `title`. `GET /boards` lists
accessible boards with an existing participant identity; the workspace board
list also discovers boards available through workspace access or business
ownership. `GET /boards/:id` returns metadata, sections, and your effective role.

Create notes through `POST /boards/:id/items` with a client-generated UUID,
`kind: "note"`, and an alphanumeric `zOrder`. Content edits require the current
`version`; position edits use `/items/:id/position` without a version. Mutations
and their events commit together. Same-board item retries return the original
item, including deleted tombstones, without another event. See
[work unit 3](docs/14-backend-board-core.md) for all routes and limits.

Blank boards support notes, image uploads, and link previews. Start the media
worker with `pnpm dev:worker` after applying migrations. JPEG, PNG, and WebP
uploads are limited to 10 MiB by default. The worker validates files, generates
thumbnails and palettes, fetches previews, and maintains media storage and events.
See [work unit 4](docs/15-backend-media-workers.md) for the HTTP flow, diagrams,
configuration, R2 setup, and worker health routes. MinIO is used only by automated
tests and is built from pinned upstream source releases.

Approval APIs are described in [work unit 7](docs/18-backend-approvals.md).
Starter kits, approval controls in the web app, budget, board archiving, plan
entitlements, and realtime follow. See [web work unit 6](docs/17-web-planner-client-ui.md)
for the working planner and client interface.

## Code style

Use braces for all `if`, `else`, and loop bodies. Put the block contents on
separate lines:

```typescript
if (!table?.present) {
  return false;
}
```

ESLint also requires strict equality, `const` where possible, and object
property shorthand. It rejects `var` and unnecessary `else` blocks after a
return. Prettier formats source and configuration files with two-space
indentation, single quotes, and a target line width of 100 characters.

Run `pnpm lint:fix`, then `pnpm format` to apply the style. Run `pnpm lint` and
`pnpm format:check` to check it. `pnpm check` and CI include both checks.
The formatter skips generated files, Markdown, and the reference SQL schema.

## Project layout

- `apps/web` — TanStack Start product and client-link experience
- `apps/api` — NestJS HTTP API and WebSocket gateway
- `apps/worker` — event dispatcher and BullMQ workers
- `packages/contracts` — shared transport and event contracts
- `packages/database` — shared database client and transaction/event primitives
- `packages/storage` — shared private R2 adapter
- `packages/kits` — data-only kit definitions
- `packages/modules` — module implementations, introduced when Phase 2 needs them
- `packages/ui` — shared presentational UI

The API, worker, contracts, database, and storage packages have a build setup. See
[docs/11-project-structure.md](docs/11-project-structure.md) before adding code or
moving a responsibility between packages.

## Keeping these docs current

- Change the spec in the same commit as the code it describes.
- Add a new entry to `docs/10-decisions.md` when a choice closes off an alternative.
- `db/schema.sql` is the reference model. Real migrations live in the API.
