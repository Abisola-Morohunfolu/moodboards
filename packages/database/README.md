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
