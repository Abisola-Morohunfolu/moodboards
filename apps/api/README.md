# API

The NestJS HTTP API and WebSocket gateway. Feature folders own request handling
and business use cases; platform folders adapt external services.

Every board write must follow the transaction and outbox rules in
`docs/02-architecture.md`. Board routes resolve access before returning data,
and callers without a role receive 404.

Real database migrations begin in `src/database/migrations`; `db/schema.sql`
remains the reference model and local bootstrap schema.
