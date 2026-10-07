# Database

Database client setup and transaction primitives shared by the API, dispatcher,
and job processors. Feature-specific queries stay with the feature or module
that owns them.

`databaseOptions` defines the Postgres pool settings. `createDataSource` creates
one TypeORM data source. Each running process initializes its own data source
once and destroys it on shutdown. The default pool limit is 10 connections.
Set `DB_POOL_MAX` to change the API limit. Keep the sum of all process pool limits
below the available Postgres connection limit.

`withTransaction(dataSource, work)` gives `work` one transaction `EntityManager`.
Use this manager for every operation in the transaction. Success commits the
writes. An error rolls them back and reaches the caller. Both paths return the
connection to the pool.

Idle connections close after 30 seconds. Connection acquisition and database
statements have two-second timeouts. The pool creates connections as needed.
This package does not import NestJS or feature code.

## Entity mappings

The explicit `databaseEntities` registry contains all columns of the 18 tables
used by implemented features. `databaseOptions` registers it for every process,
the migration CLI, and tests. Each class lives in its own `*.entity.ts` file under `src/entities`, grouped into
`accounts`, `workspaces`, `clients`, `boards`, `media`, `outbox`, and `approvals`
folders. Folder indexes export the related classes; the root index assembles the
registry. Shared enum values live in `entities/types.ts`.
Properties use camelCase, with explicit existing database column names. UUIDs
remain caller-generated, apart from the database-generated board event identity.

Foreign-key IDs are scalar properties; queries join entity classes explicitly.
Migrations own constraints, indexes, foreign keys, and schema changes. Neither
entity registration nor application startup modifies the schema. Keep
`synchronize: false` and `migrationsRun: false`.

Postgres `bigint` fields use strings, `timestamptz` uses `Date`, and `bytea` uses
`Buffer`. Arrays, JSON, enum names, nullability, and defaults match migrations.
Version, timestamp, and deletion fields are ordinary columns: no automatic
version increment, update-date behavior, or implicit soft-delete filtering.

## Writing feature queries

Feature repositories own persistence. Services coordinate authorization,
business rules, resource locks, transactions, events, and external adapters.
Worker repositories follow the same boundary for dispatch, media, and
maintenance. Infrastructure probes and `LISTEN/NOTIFY` stay in runtime adapters.
Shared database code never imports NestJS or application feature code.

Use query builders for ordinary reads, joins, inserts, updates, and deletes.
Create builders from the supplied transaction manager, not a cached global
repository or data source manager:

```ts
const items = await manager.createQueryBuilder(ItemEntity, 'item')
  .where('item.boardId = :boardId', { boardId })
  .andWhere('item.deletedAt IS NULL')
  .orderBy('item.zOrder COLLATE "C"')
  .addOrderBy('item.id')
  .getMany();
```

`getOne` and `getMany` hydrate entity properties. `getRawOne`/`getRawMany` are
projections: use explicit result aliases and named projection types. Persistence
entities are never HTTP response contracts; owning features provide explicit
response mappers for dates, private fields, and role-based output.

### Mutations and patches

`RETURNING` results are raw database records, even when the builder targets an
entity. Map complete returned records with `entityFromRow(manager, Entity, row)`;
this uses registered column metadata and driver hydration. It is not runtime
validation and must not be used to pretend a partial projection is a full entity.
Use `affected` when only the changed row count matters.

```ts
const patch = definedPatch(input, ['title', 'note', 'priceCents', 'quantity'] as const);
const result = await manager.createQueryBuilder().update(ItemEntity)
  .set({ ...patch.values, version: () => 'version + 1', updatedAt: () => 'now()' })
  .where('board_id = :boardId AND id = :itemId AND version = :version AND deleted_at IS NULL',
    { boardId, itemId, version: input.version })
  .returning('*')
  .execute();
const item = result.raw[0] ? entityFromRow(manager, ItemEntity, result.raw[0]) : null;
```

`definedPatch` accepts a code-owned property allowlist. Undefined means leave
unchanged; null clears a nullable column. `changedFields` preserves request field
ordering. Content edits explicitly increment `version`; movement explicitly
updates only position fields and `updatedAt`. Read deletion markers explicitly,
including tombstones on idempotent retries. Avoid `.save()` for versioned writes:
use a version predicate in the mutation itself.

### Focused Postgres SQL

Use the SQL tag for operations whose semantics are clearer as Postgres SQL:
advisory locks, atomic delivery claims, approval lateral queries/reconciliation,
conditional approval upserts, and bounded event pruning. Keep these operations in
named repository methods or shared transaction primitives.

```ts
const rows = await manager.sql<{ id: string }[]>`
  WITH removed AS (
    DELETE FROM board_events WHERE dispatched_at < ${before} RETURNING id
  )
  SELECT id FROM removed
`;
```

The tag binds values, including arrays and buffers. SQL fragments and identifiers
must remain code-owned; never interpolate request-supplied column names. Direct
SQL `UPDATE` and `DELETE` return `[rows, affectedCount]` in this driver; mutation
CTEs ending in `SELECT` return ordinary row arrays. Query-builder `.execute()`
returns a result object instead. Keep these representations explicit.

## Verification

`tests/entities.integration.spec.ts` compares the registered mappings against the
migrated disposable database, checks identity metadata, and round trips defaults,
nullable values, arrays, buffers, JSON, dates, composite keys, and large bigint
values. It also verifies entity writes and outbox rollback on one connection.
Feature and worker regression tests cover the query semantics and lock protocol.

See [backend work unit 8](../../docs/19-backend-database-mapping.md) for the phase
boundaries, diagrams, and approval regressions.
