# Backend work unit 4: media items and workers

Branch: `codex/backend-media-workers`.

Authenticated blank canvas boards support notes, images, and links. The separate
worker dispatches committed media events into BullMQ, validates images, fetches
shared previews, and performs media maintenance. Frontend, realtime, copies,
billing entitlements, and other job types remain later work units.

## HTTP contracts

All routes use existing session cookies, board permissions, camelCase fields,
UTC ISO timestamps, and `Cache-Control: no-store`.

| Method | Route | Permission | Result |
|--------|-------|------------|--------|
| POST | `/boards/:id/assets/presign` | `item.create` | `{ assetId, url, headers, expiresAt }`; upload URL lasts five minutes |
| POST | `/boards/:id/items` | `item.create` | Note, image with `assetId`, or link with `url`; 201 on creation, 200 on same-board retry |
| GET | `/boards/:id/items` | `board.view` | All live item kinds; image has `asset`, link has `preview` |
| GET | `/assets/:id/url?variant=original\|thumbnail` | `board.view` | `{ url, expiresAt }`, five minutes; original is the default |

The presign body is `{ mime, bytes }`. MIME is `image/jpeg`, `image/png`, or
`image/webp`; bytes is an exact positive integer, limited by
`MEDIA_UPLOAD_MAX_BYTES` (default 10 MiB). There are no paid upload tiers yet.
Unsupported fields and variants return 400. Upload signatures include MIME and
exact `Content-Length`; the actual file is checked again by the worker.

For browser uploads, send the file/blob body and the returned `Content-Type`.
The browser supplies `Content-Length`; JavaScript cannot set that forbidden
header manually. Configure the private bucket's CORS for the application origins,
PUT/GET/HEAD, and Content-Type. Do not make the bucket publicly readable.

Notes retain their existing wire shape. Images include asset ID, status, MIME,
bytes, nullable dimensions, and nullable palette. Links include preview ID, URL,
status, nullable metadata, and fetched/expiry timestamps. Lists never expose
storage keys or signed URLs. Monetary fields still pass through the same role
filter, including stale-version responses.

Sources are immutable: patches may edit title, note, price, and quantity only.
Position changes still leave content versions unchanged. Same-board creation
retries ignore changed input and return the original item, even its tombstone,
without another event or rechecking an old upload. Unknown assets and assets on
another board return 404. Missing uploads, failed assets, and URL requests for
pending/failed assets return 409. Storage outages return 503; notes remain usable.

## Upload lifecycle

```mermaid
sequenceDiagram
    actor User
    participant API
    participant DB as Postgres
    participant Store as Private storage
    participant Worker as Image processor
    User->>API: Reserve image upload
    API->>DB: Insert pending asset
    API-->>User: Asset ID and staging PUT URL
    User->>Store: Upload file
    User->>API: Create image item
    API->>Store: Check uploaded object
    API->>DB: Commit item and item.created event
    API-->>User: Pending image item
    DB-->>Worker: Dispatch through BullMQ
    Worker->>Store: Read and validate staging bytes
    Worker->>Store: Write verified original and thumbnail
    Worker->>DB: Commit ready asset and asset.ready event
    User->>API: Read item and request media URL
    API-->>User: Ready metadata and signed GET URL
```

Storage requests run outside board-lock transactions. Authorization and asset
ownership are checked again when attaching the asset. Presign creates a private
staging key; it does not write an item or board event. The worker bounds the
read, checks MIME against decoded format and actual byte count, rejects corrupt
and animated files, and caps decoded size at 40 million pixels.

A successful job writes the exact verified original plus an orientation-corrected
WebP thumbnail (longest edge at most 512 pixels, no enlargement), with a five-colour
palette. Every processing attempt uses fresh output keys. The winning pending-to-
ready transition and its event commit together; duplicate attempts cannot change
a ready asset or emit a second completion. Failed attempts leave objects for GC.
Only ready final keys are signed for reads. Reusing the staging PUT URL cannot
change a promoted original or thumbnail.

## Shared previews

Link URLs accept HTTP/HTTPS, ports 80/443, no credentials, and at most 8192
characters. WHATWG serialization removes fragments and preserves queries; a
SHA-256 hash identifies the shared preview. Saving an existing URL never resets
its row. Failed previews retain the saved link and any previous metadata.

The egress adapter rejects non-public IPv4/IPv6 addresses, including IPv4-mapped
IPv6, and mixed public/private DNS answers. Its request lookup uses the validated
address, rather than resolving again at connection time. Every redirect repeats
validation. Limits are three redirects, five seconds total including DNS, and
2 MiB for both encoded and decoded response bodies. Scripts never execute and
remote preview images are metadata only, not fetched or cached.

Parsing uses Open Graph, supported JSON-LD types, then ordinary HTML title and
description. Success expires in seven days; failure expires in one day and keeps
previous fields. Jobs identify a fetch generation using the previous expiry.
Stale or duplicate completions are ignored. Link attachment and completion take
the same preview advisory lock **before** board locks. Completion locks affected
boards in ID order and atomically emits one result event per live referencing
board. Worker events use null participant attribution.

## Dispatch and maintenance

```mermaid
flowchart LR
    API["Authenticated API"] -->|Atomic item and event| DB[("Postgres")]
    DB -->|"NOTIFY and five-second polling"| D["Outbox dispatcher"]
    D -->|Leased delivery| Q["BullMQ on Redis"]
    Q --> I["Image processor"]
    Q --> P["Preview processor"]
    I --> S[("Private storage")]
    I -->|Atomic result and event| DB
    P -->|Filtered HTTP| Web["Public websites"]
    P -->|Atomic result and events| DB
    M["Daily maintenance"] --> DB
    M --> S
```

The dispatcher claims up to 100 unfanned events with `FOR UPDATE SKIP LOCKED`.
Only media `item.created` events target queues. Other events, including historical
note events, finish without targets. A delivery is finished once its queue job is
confirmed, not when processing finishes. The event finishes after all deliveries
have succeeded or exhausted their retries.

Delivery claims increment attempts and assign a 30-second token lease. Redis I/O
runs outside transactions with a two-second deadline. Acknowledgements require
the same unexpired token. Crashes after enqueue are safe because entity/generation
job IDs deduplicate the repeated delivery. Queue producers disable offline command
buffering. Delivery and processing each have ten attempts, exponential backoff
starting at one second and capped at five minutes. Invalid media fails immediately.
Terminal processing failures commit status and a failure event together.

A minute reconciliation pass restores absent jobs for pending referenced media
and records terminal failure from exhausted jobs. Terminal BullMQ jobs are retained
for 31 days; database idempotency remains authoritative after job removal.

Daily maintenance runs at/after 02:00 UTC, with startup catch-up and a database
advisory lock preventing overlapping runners. It refreshes expired referenced
previews, removes unattached asset reservations older than 24 hours under board
locks, and sweeps objects older than 24 hours only if neither original nor thumbnail
keys reference them. Soft-deleted items still count as references. Dispatched
events older than 30 days are pruned in batches of 10,000; pending events remain.
Maintenance is idempotent, so restarting a worker can safely repeat the day's work.

## Running and validating

The API and worker use a private Cloudflare R2 Standard bucket. Automated tests
use disposable local MinIO, built from pinned official server/CLI source releases
in `docker/minio/Dockerfile`; the first test start downloads Go dependencies.
MinIO is not part of normal development startup.

```bash
pnpm install --frozen-lockfile
docker compose up -d --wait postgres redis
pnpm db:migrate
pnpm dev:api
# In another terminal:
pnpm dev:worker
```

Apply migrations before starting workers. API and worker share the four R2_*
fields from `.env.example`. With all four unset or empty, API media routes return
503; partial configuration fails validation without logging credentials. Worker
requires Postgres, Redis, and R2 configuration and never applies migrations. Redis uses no eviction and persistent development storage.
Worker listens at `127.0.0.1:3002` by default (`WORKER_HOST`, `WORKER_PORT`). Its
`/health/live` returns 200; `/health/ready` verifies the lease schema, Redis command
response, and private bucket, returning 503 on failure with a two-second deadline.
Shutdown stops intake, waits for active jobs, and closes listeners and connections.

```bash
pnpm db:test:start
export TEST_DATABASE_URL=postgres://moodboard_test:moodboard_test@127.0.0.1:5433/moodboard_test
export TEST_REDIS_URL=redis://127.0.0.1:6380/15
export TEST_STORAGE_ENDPOINT=http://127.0.0.1:9002
export TEST_STORAGE_BUCKET=moodboard-test-assets
pnpm check
pnpm db:test:stop
```

Tests create only the isolated `moodboard-test-` bucket and reject development
storage settings. Preview fixtures mock DNS/HTTP or inject a fetcher; they do not
crawl public sites. The HTTP smoke test runs actual BullMQ workers and MinIO.

Browser compatibility can also be checked interactively after building packages:

```bash
TEST_STORAGE_ENDPOINT=http://127.0.0.1:9002 TEST_STORAGE_BUCKET=moodboard-test-assets node scripts/test-browser-upload.mjs
```

Open `http://127.0.0.1:9060` and run the upload test. It supplies a Blob and
Content-Type only, then independently verifies stored MIME and exact bytes.
The browser supplies the signed length. Stop the harness with Ctrl-C.

## Fresh R2 setup

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), enable the R2
   subscription. It includes free monthly usage and bills for overages.
2. Create a **Standard** bucket named `moodboard-assets`. Keep public access and
   the `r2.dev` URL disabled; do not enable an Infrequent Access lifecycle rule.
3. Create R2 S3 API credentials with **Object Read & Write** access restricted to
   this bucket. Copy the account ID, Access Key ID, and Secret Access Key into
   the ignored `.env` file; never commit them or paste them into logs.
4. Uncomment and set all four fields:

   ```dotenv
   R2_ACCOUNT_ID=<32-character-account-id>
   R2_BUCKET=moodboard-assets
   R2_ACCESS_KEY_ID=<r2-access-key-id>
   R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
   ```

   The app derives `https://<account-id>.r2.cloudflarestorage.com` and uses
   region `auto`. There are no application endpoint, region, or path-style
   overrides. Both API and worker must use the same bucket and credentials.
5. In bucket settings, paste the CORS policy from
   [`config/r2-cors.json`](../config/r2-cors.json). It allows
   `http://localhost:3000` and `http://127.0.0.1:3000`, PUT/GET/HEAD,
   Content-Type, and exposes ETag. Before deployment, configure the exact HTTPS
   application origins for its bucket; do not use a wildcard origin.
6. Start the API and worker with the commands above. The worker's readiness
   check validates bucket access; an empty or partially configured worker cannot start.

R2 Standard currently includes 10 GB-month of storage, 1 million Class A
(write/list) operations and 10 million Class B (read) operations monthly, with
free egress. These allowances apply across the account, not per bucket. Usage
beyond them is billed; there is no spending cap implemented by this app.
Check Storage & databases > R2 > Overview and the account Billing pages regularly.
Originals, thumbnails, staging objects and abandoned attempts all consume storage;
the existing daily maintenance removes unreferenced objects after 24 hours.
See [current pricing](https://developers.cloudflare.com/r2/pricing/),
[SDK setup](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/), and
[CORS](https://developers.cloudflare.com/r2/buckets/cors/).

### Opt-in live R2 verification

After starting the API with R2 credentials, leave the queue worker stopped and run:

```bash
pnpm storage:smoke:r2
```

Open `http://127.0.0.1:3000` and click **Run R2 smoke check**. This development-only
harness creates its own temporary user, workspace, board and image. The browser
uploads a Blob using only the signed Content-Type; the harness invokes the same image processor used by the media worker
to validate and promote it and generate the thumbnail. A running queue worker is
not needed; queue dispatch is covered by the isolated end-to-end tests. The harness verifies
signed downloads, byte count, MIME, thumbnail dimensions, private access, object
listing, and deletion, then removes its own records and objects. Stop it with
Ctrl-C after the result. Port 3000 must be free and covered by bucket CORS;
`R2_SMOKE_PORT` can change it if CORS is adjusted too. Tests and CI never run this
check or need cloud credentials.
