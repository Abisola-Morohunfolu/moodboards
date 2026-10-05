# Worker

Separate Node process implementing media outbox dispatch, image processing, shared
link previews, and daily maintenance. Requires migrated Postgres, Redis, and a
private Cloudflare R2 Standard bucket with all four R2_* credentials configured. Run `pnpm dev:worker` from the root after migration.
Health endpoints listen on `127.0.0.1:3002` by default.

See [work unit 4](../../docs/15-backend-media-workers.md) for diagrams, queue
retry boundaries, configuration, cleanup rules, and verification commands.
Realtime publication and other processors remain later work.
