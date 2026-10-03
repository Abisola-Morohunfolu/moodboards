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

## Local development

Use Node.js 24 and pnpm 10.33.0. The backend includes account authentication, workspace onboarding, and shared
database and contract packages. The worker and web app do not have code yet.

Start Docker. Then run these commands from the project root:

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait postgres
pnpm db:migrate
pnpm dev:api
```

| Service | Address | Use |
|---------|---------|-----|
| Postgres 15 | `localhost:5432` | Uses explicit TypeORM migrations |
| Redis 7 | `localhost:6379` | Pub/sub and BullMQ, with eviction off |
| MinIO | `localhost:9000`, console `localhost:9001` | S3-compatible storage, private `moodboard-assets` bucket |
| Mailpit | SMTP `localhost:1025`, inbox `localhost:8025` | Catches every email |
| Stripe CLI | opt-in: `docker compose --profile stripe up -d` | Forwards test webhooks to `localhost:3001/webhooks/stripe` |

Check `http://127.0.0.1:3001/health/live` and
`http://127.0.0.1:3001/health/ready`. Both routes return `200` after migration.
Use `pnpm db:status` to check migration records. This command fails if a migration
is pending. Use `pnpm start:api` to run the last build without a file watcher.

The database now uses the `postgres-migrations-data` volume. The old
`postgres-data` volume and its data remain available. Do not delete volumes to
apply a schema change. Add a migration and run `pnpm db:migrate`.

To start the other backing services, run `docker compose up -d --wait`.

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
See [Google setup and the manual smoke test](docs/13-backend-accounts-workspaces.md).
Account linking, password reset, and local email verification are deferred.

## Backend tests

Use a separate test database. It has temporary storage. These commands do not
use the development database:

```bash
pnpm db:test:start
export TEST_DATABASE_URL=postgres://moodboard_test:moodboard_test@127.0.0.1:5433/moodboard_test
pnpm check
pnpm db:test:stop
```

You must export `TEST_DATABASE_URL`. Tests do not read it from `.env` and do not
use `DATABASE_URL` as a fallback. Tests require the database name `moodboard_test`.
Use `TEST_POSTGRES_PORT` to change the test service port. Change the test URL too.

Run `pnpm test:unit`, `pnpm test:integration`, or `pnpm test:e2e` for one test group.
Database test groups run in sequence. Do not run them against the same database
at the same time. CI uses a separate Postgres 15 service and runs `pnpm check`.

See [the work unit and its test gates](docs/12-backend-foundation.md).

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
- `packages/database` — shared database client and transaction primitives
- `packages/kits` — data-only kit definitions
- `packages/modules` — module implementations, introduced when Phase 2 needs them
- `packages/ui` — shared presentational UI

Only the API, contracts, and database packages have a build setup. See
[docs/11-project-structure.md](docs/11-project-structure.md) before adding code or
moving a responsibility between packages.

## Keeping these docs current

- Change the spec in the same commit as the code it describes.
- Add a new entry to `docs/10-decisions.md` when a choice closes off an alternative.
- `db/schema.sql` is the reference model. Real migrations live in the API.
