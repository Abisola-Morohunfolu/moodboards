# Project structure

The codebase is a TypeScript monorepo with three deployable apps and a small set
of shared packages. This mirrors the runtime boundaries in
[02-architecture.md](02-architecture.md). The first backend work unit adds pnpm,
TypeScript, NestJS, TypeORM, Zod, ESLint, and Jest. Package versions are fixed.

```text
apps/
  web/                    TanStack Start application
    src/
      routes/             File-based routes and root layout
      components/         App-specific composed components
      features/           Product features grouped by domain
      lib/                Browser and TanStack Start infrastructure
      styles/             Global styles and design tokens
  api/                    NestJS API and WebSocket gateway
    src/
      core/               Cross-domain application rules
      database/           API database adapters and migrations
        migrations/
      features/           HTTP use cases grouped by domain
        access/
        auth/
        billing/
        boards/
        clients/
        exports/
        items/
        workspaces/
      platform/           External and runtime adapters
        email/
        events/
        realtime/
        storage/
  worker/                 Dispatcher and background jobs
    src/
      dispatcher/         Outbox fan-out and delivery retries
      jobs/               BullMQ job processors
      queues/             Queue names, payloads, and registration
packages/
  contracts/              Shared HTTP, WebSocket, job, and event shapes
  database/               Database client and shared transaction/event helpers
  storage/                Private Cloudflare R2 adapter
  kits/                   Data-only board kit definitions
  modules/                Module registry and implementations from Phase 2
  ui/                     Shared presentational React components
db/
  schema.sql              Reference model used by local bootstrap
docs/                     Product and engineering specifications
```

## Dependency direction

```text
apps -> packages
packages/modules -> packages/contracts, packages/database
packages/kits -> packages/contracts
packages/ui -> packages/contracts
```

Shared packages never import an app. `contracts` contains schemas and types, not
business logic or database access. `database` contains primitives shared by the
API, dispatcher, and workers; feature-specific queries stay with their owner.

The API core does not import a board module. The application composition root
will assemble the module registry, and the dispatcher will invoke handlers
through that registry. A module owns its routes, handlers, queries, tables, and
UI slot implementations, as described in
[04-modules-and-kits.md](04-modules-and-kits.md).

## Build order

Phase 1 starts in the app feature folders. Approvals and budget remain ordinary
API and web features until the second kit forces the module boundary in Phase 2.
The `packages/modules` folder is therefore only a documented extension point for
now. Likewise, kit definitions stay data-only and must not introduce database
migrations.

The first implementation work unit adds root workspace tools, health, migrations,
and shared packages. Work unit 2 adds accounts and workspace onboarding. Work
unit 3 adds access, boards, sections, and note features, plus the transactional
event writer under API platform adapters. Blank boards do not yet need a kits
package or module registry. Work unit 4 adds the media dispatcher, workers, maintenance, and shared storage
adapter. The web app still has no runtime code.
