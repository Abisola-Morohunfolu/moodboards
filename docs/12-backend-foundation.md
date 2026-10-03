# Backend work unit 1

This work unit supplies the API and database setup. Product features follow.
Use branch `codex/backend-foundation`.

## Components

```mermaid
flowchart LR
    Client["HTTP client"] --> API["NestJS API"]
    API --> Health["Health service"]
    Health --> Pool["TypeORM connection pool"]
    Pool --> PG[("Postgres 15")]
    Contracts["Zod response schemas"] -.-> API
    Command["Migration command"] --> PG
```

The API owns HTTP handling and NestJS providers. The shared database package
owns connection settings and transaction functions. It does not import NestJS.
The contracts package owns response schemas and inferred types.

## Connection use

Create one data source and pool per process. Initialize the data source at
startup. Inject the same data source into services. Do not create a pool for
each request.

```mermaid
sequenceDiagram
    participant S as API service
    participant P as Connection pool
    participant D as Postgres
    S->>P: Get an available connection
    P-->>S: Supply connection
    S->>D: Execute transaction
    D-->>S: Commit or rollback
    S->>P: Return connection for reuse
    Note over P: Close all connections at process shutdown
```

The default pool limit is 10. `DB_POOL_MAX` changes the API limit. Each deployed
API instance has a separate pool. Idle connections close after 30 seconds.
Connection acquisition and statements have two-second timeouts. The readiness
route also has a two-second deadline for its complete check.
The check uses one connection. If the deadline expires during a query, it closes
that connection so the pool does not reuse a stalled client. A connection acquired
after the deadline returns to the pool without running queries.

Use `withTransaction` for related writes. Use only the supplied `EntityManager`
inside the transaction. An error cancels all writes and reaches the caller.
The connection returns to the pool after commit or rollback.

## Testable parts

Complete a part and its checks before starting the next part.

| Part | Result | Check |
|------|--------|-------|
| A. Workspace | Fixed package versions, pnpm workspace, TypeScript, ESLint, and Jest | Frozen install, build, type check, lint, and contract tests |
| B. API | Configuration validation, live route, and shutdown hooks | Configuration and startup unit tests |
| C. Database | Shared pool settings and transaction function | Pool reuse, commit, rollback, error, and closure integration tests |
| D. Migration | Full schema in one fixed migration | Schema comparison, constraints, notifications, repeat run, failure, and revert integration tests |
| E. Readiness | Ready route, separate test database, and CI | Readiness unit tests, HTTP tests, and `pnpm check` |

The migration test compares columns, constraints, indexes, enums, the function,
and the trigger with the reference schema. The reference schema is read only
by that test. The migration does not read it at runtime.

The migration revert removes application objects in dependency order. It keeps
the `citext` extension and the migration history table. The revert command only
accepts the disposable `moodboard_test` database. Production schema changes use
new migrations.

## Run the checks

Start Docker, then run these commands from the project root:

```bash
pnpm install --frozen-lockfile
pnpm db:test:start
export TEST_DATABASE_URL=postgres://moodboard_test:moodboard_test@127.0.0.1:5433/moodboard_test
pnpm check
pnpm db:test:stop
```

Database tests require `TEST_DATABASE_URL`. They reject a database name other
than `moodboard_test`. They also reject the development database as a test
target. The test service uses temporary storage. Stop it only after the tests
finish. CI supplies its own separate Postgres 15 service.

`pnpm check` runs format checks, lint, build, type checks, unit tests, integration tests, and
HTTP tests. Any failed check returns a nonzero exit code.

## Health routes

Both routes require no authentication.

| Route | Success | Failure |
|-------|---------|---------|
| `GET /health/live` | `200`, with `status: ok` | No database dependency |
| `GET /health/ready` | `200`, with both checks set to `ok` | `503`, with `status: down` |

Readiness returns `checks.postgres` and `checks.migrations`. Each value is `ok`
or `down`. The route never creates the migration history table or applies a
migration. It does not return database errors or connection details.

The tests simulate a database failure and check the next successful request.
They also terminate a real Postgres connection and check that the pool replaces
it. A TCP proxy test stalls an established connection and verifies that the
readiness deadline discards it, then recovers with a replacement in a pool of one.
A full database outage can still require connection retries by the caller.

## Development startup

Copy `.env.example` to `.env`. Start the development Postgres service. Apply the
migration, then start the API. The new database volume preserves the previous
volume and its data. See the root README for the commands.

`pnpm dev:api` builds all three packages and starts file watchers. Source changes
produce a new build. Node.js restarts the API when its compiled files change.
`pnpm start:api` runs the last build without file watchers.

Set `API_HOST=0.0.0.0` for a container deployment. The local default is
`127.0.0.1`. Run migrations as a separate deployment step before API startup.

Account and workspace functions are implemented in [work unit 2](13-backend-accounts-workspaces.md). Board routes, workers,
and the web app remain outside this work unit.
