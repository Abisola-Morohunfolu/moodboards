# Worker

The outbox dispatcher and BullMQ processors.

- `src/dispatcher` fans out board events and retries independent deliveries.
- `src/queues` defines queue registration and payload boundaries.
- `src/jobs` contains processors such as link preview, image processing, email,
  PDF export, preview refresh, event pruning, and storage garbage collection.

Handlers are idempotent, read current state, and publish their events only after
the database transaction commits.
