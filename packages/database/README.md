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

## Writing feature queries

Keep persistence queries in the owning feature's repository. Services coordinate
access checks, business rules, locks, transactions, and events. Pass the callback's
transaction manager to every repository operation that must commit together;
using the data source's global manager would leave that transaction.

For fixed queries, use TypeORM's SQL tag with values beside the expressions they
belong to. The tag binds values as parameters, including arrays and buffers:

```ts
const rows = await manager.sql<{ id: string; version: number }[]>`
  SELECT id, version
  FROM items
  WHERE board_id = ${boardId} AND id = ${itemId}
`;
```

Use explicit projections that match the declared result type. Table records and
joined results have different shapes: a decision insert returns decision fields;
a joined read can also return contact fields. The generic describes expected
rows; it does not validate the SQL against the schema or check rows at runtime.

Values can be bound, but column names and SQL clauses cannot. A function returning
a string in a SQL tag inserts unescaped SQL. Limit this mechanism to constants
owned by the repository, never request input:

```ts
const columns = 'id, board_id, version';
const rows = await manager.sql<{ id: string; board_id: string; version: number }[]>`
  SELECT ${() => columns}
  FROM items
  WHERE id = ${itemId}
`;
```

Dynamic patches can keep `.query<T>()` with a code-owned column map and separately
bound values. Preserve the difference between `undefined` (leave unchanged) and
`null` (clear a nullable field), along with version conditions and field ordering.
Format SQL with uppercase keywords and readable clause breaks.

The installed TypeORM Postgres driver returns direct `UPDATE` and `DELETE`
queries as `[rows, affectedCount]`. A mutation CTE ending in `SELECT` returns a
plain array of rows, matching callers that read `rows[0]` or `rows.length`:

```ts
const rows = await manager.sql<{ id: string }[]>`
  WITH changed AS (
    UPDATE items
    SET deleted_at = now(), updated_at = now()
    WHERE board_id = ${boardId} AND id = ${itemId} AND deleted_at IS NULL
    RETURNING id
  )
  SELECT id FROM changed
`;
```

Using the SQL tag changes parameter handling, not the driver's result shape.
