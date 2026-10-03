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

## Local development

`compose.yaml` runs the backing services. The API, workers, and web app run on the host against them.

```bash
cp .env.example .env
docker compose up -d
```

| Service | Address | Use |
|---------|---------|-----|
| Postgres 15 | `localhost:5432` | Loads `db/schema.sql` on first start |
| Redis 7 | `localhost:6379` | Pub/sub and BullMQ, with eviction off |
| MinIO | `localhost:9000`, console `localhost:9001` | S3-compatible storage, private `moodboard-assets` bucket |
| Mailpit | SMTP `localhost:1025`, inbox `localhost:8025` | Catches every email |
| Stripe CLI | opt-in: `docker compose --profile stripe up -d` | Forwards test webhooks to `localhost:3001/webhooks/stripe` |

The schema loads only into an empty database. After changing `db/schema.sql`, run `docker compose down -v` and start again. This deletes local data.

## Project layout

- `apps/web` — TanStack Start product and client-link experience
- `apps/api` — NestJS HTTP API and WebSocket gateway
- `apps/worker` — event dispatcher and BullMQ workers
- `packages/contracts` — shared transport and event contracts
- `packages/database` — shared database client and transaction primitives
- `packages/kits` — data-only kit definitions
- `packages/modules` — module implementations, introduced when Phase 2 needs them
- `packages/ui` — shared presentational UI

The folders are intentionally framework-light for now. See
[docs/11-project-structure.md](docs/11-project-structure.md) before adding code or
moving a responsibility between packages.

## Keeping these docs current

- Change the spec in the same commit as the code it describes.
- Add a new entry to `docs/10-decisions.md` when a choice closes off an alternative.
- `db/schema.sql` is the reference model. Real migrations live with the code once it exists.
