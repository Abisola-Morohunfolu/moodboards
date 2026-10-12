# Private beta operation and recovery

This is the repository deployment baseline. No hosting account, domain, support
mailbox, live backup schedule, or alert destination has been provisioned. The beta
must not open until an operator fills those in and records acceptance evidence in
`docs/23-mvp-release-checklist.md`. Privacy and terms pages are beta drafts: the
operator must identify themselves, hosting providers/region, and actual retention
and review the notices for the chosen launch before inviting anyone.

## Deploy with Docker

Use a Docker host with Compose v2, persistent disk, and inbound ports 80/443. The
single locked application image runs three processes in separate containers:
TanStack Start web, Nest API, and media worker. Postgres 15 and Redis 7 use named
volumes. Private Cloudflare R2 remains external; MinIO is only a test adapter.
The production web adapter uses `srvx` to serve `dist/client` and the generated
SSR fetch handler, following [TanStack's Node hosting guidance](https://tanstack.com/start/latest/docs/framework/react/guide/hosting).

1. Copy `deploy/beta.env.example` to `.env.beta` and `chmod 600 .env.beta`.
   Use `moodboard:beta-<full-commit-sha>` for `RELEASE_IMAGE`; never reuse a tag.
   Set real sibling web/API domains, two separate hex database/Redis secrets,
   complete R2 credentials, a random `LINK_SECRET` of at least 32 characters, a
   monitored `SUPPORT_EMAIL`, and up to 25 invited `BETA_SIGNUP_EMAILS`.
   Production refuses to start without a nonempty invite list. Unlisted password
   signups and Google callbacks return 403. Removing an invitation does not revoke
   an already registered password account; use the support procedure for that.
2. Point both domain records at the host. Keep web/API on the same registrable
   domain: Secure, HttpOnly, SameSite=Lax cookies are host-scoped to the API and
   sent by credentialed browser requests. Independent-site hosting requires a
   separately designed cookie/CSRF configuration. Google remains unset.
3. Set R2 CORS to the exact HTTPS web origin, methods PUT/GET/HEAD, header
   Content-Type, and exposed ETag. Keep the bucket private. Run the existing
   `pnpm storage:smoke:r2` with production credentials on an operator workstation,
   then test browser uploads on the deployed domain. The API readiness check
   covers Postgres/migrations; worker readiness covers Postgres, Redis, and storage.
4. Run `bash scripts/beta-deploy.sh`. It validates Compose, builds, starts stores,
   takes a database backup on subsequent deployments, runs migrations before
   rollout, and waits for application health. It does not delete volumes.
5. Confirm HTTPS and `https://<api>/health/ready`, `https://<web>/help`, and an actual
   signed-in browser request to `/me`. Test rejected origins and cookies with real
   hostnames. Verify signup of an unlisted address is denied.

The proxy is the only published service. Its fixed network IP `172.30.0.10` is the
API's sole trusted proxy, and Caddy overwrites X-Forwarded-For with the connecting
client IP. If this subnet conflicts with host networking, change both the Compose
subnet/address and API trust configuration together. Do not put an additional CDN
in front of this baseline without explicitly configuring and testing its trusted
IP ranges. Access logging is disabled in both Caddy and the web adapter because
share URL paths contain tokens. Do not enable raw URL logging in a hosting layer.

The build excludes secrets and local test artifacts. Runtime uses an unprivileged
Node user. One workspace dependency graph is retained in the shared image; no new
orchestration platform or app-specific build pipeline is required. VITE values are
public build-time settings; rebuild when API origin or support email changes.

## Backups and restored media

Before inviting users, schedule `bash scripts/beta-backup.sh` daily with the host's
scheduler and before every rollout. It writes a private custom-format pg_dump to
`.backups`. Encrypt and copy successful backups off-host, alert on failure, and keep
14 daily copies. This local script alone is not a backup schedule or off-host copy.
Confirm actual disk and encrypted-store retention before publishing the notice.

Retain all R2 originals and thumbnails at least as long as every retained database
backup. Do not add bucket lifecycle deletion during beta. Trash is non-expiring and
counts toward storage usage. Database recovery alone cannot restore deleted media.
Enable provider-level media retention or maintain a separate encrypted media copy;
record which mechanism is used and verify an original plus thumbnail after restore.

Test restoration monthly and before beta opens, into an isolated Postgres 15 server
with a new volume. Never restore over the live database to test a dump:

```bash
# The isolated restore database is created on a separate disposable instance.
pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" backup.dump
```

Record backup timestamp/checksum, restored migration records and table counts,
a login, a board with note/link/image, and a usable original/thumbnail. Test services
in `compose.test.yaml` can validate the dump format but do not prove production
backups or media recovery. On disaster recovery: stop writes and workers, restore
the matching database and media snapshot, apply only the intended release's
migrations, re-run acceptance, then resume access. Ensure sessions/links belonging
to deletion or revocation requests are not reactivated by an older backup.

## Health, capacity, and alerts

Assign one named support operator and backup operator, and record their contact
and monitored alert destination in the release evidence. Start with 25 invitees,
200 active items per board, and 1 GiB retained original uploads per account. These
are supported beta boundaries monitored by the operator, not automatic quotas.
The hard file limit remains 10 MiB. Include thumbnails, shared previews, and trash
when reviewing actual R2 storage cost. Pause new invitations before capacity is
exhausted; public signup requires enforced quotas and broader write limits.

Configure external HTTPS checks every minute on API readiness and the web help
route, alerting after two failures. Check worker readiness internally every minute;
a container becoming unhealthy does not itself deliver an alert or restart it.
Run `deploy/monitor.sql` daily through psql and alert on failed assets, pending
assets older than 15 minutes, unsupported board/account sizes, database or host
disk above 80%, and storage growth above the cohort budget. Check Redis PING,
used_memory/maxmemory, failed/stalled BullMQ jobs, dispatcher delivery failures,
and last successful backup. Worker structured logs include terminal job failures
without saved URLs. Redis uses noeviction; capacity failures must alert, not evict
queued work. Monitoring installation and delivery remain deployment gates.

## Identity-checked support recovery

Use the monitored mailbox or existing invitation conversation. A claimed email
alone is not proof. Confirm control of the invited mailbox by replying through the
original invitation channel, plus the invitation record. If identity cannot be
verified, do not reset access. Record request ID, operator, verified user ID,
method, action, and completion time in a restricted support log; omit passwords,
share tokens, board content, and credentials. Reply with a target resolution time
within two working days and track requests to completion.

After verification, have the user choose a replacement of 15–128 characters via
a secure live channel. Run the compiled support command with the password on stdin,
not as a command argument, environment variable, or committed file. For example,
from a Bash shell, with terminal echo disabled by `read -s`:

```bash
read -r -s -p 'Replacement password: ' beta_password
printf '\n'
printf '%s' "$beta_password" | docker compose --env-file .env.beta -f compose.beta.yaml \
  run --rm -T --no-deps api node apps/api/dist/features/auth/support.cli.js \
  reset-password 'verified-user@example.com' --identity-verified
unset beta_password
```

The command atomically replaces the existing password hash and revokes every
account session. It refuses deleted accounts and Google-only accounts. Never send
an existing password; it cannot be recovered. Confirm old-session failure and
new-password login. Self-service email resets/verification remain public-launch
work. Google sign-in is unadvertised and is not an invited-beta recovery method.

For exhausted image jobs, check readiness, terminal worker logs, and the saved
asset status. Resolve the storage/Redis problem first. Ask the user to re-upload
the original as a new capture and wait for processing to complete before trashing
the failed card. A save retry is not a processing retry. Do not tell a user to
repeatedly save an uncertain capture; retry its preserved capture UUID instead.

## Supported account/data deletion requests

Verify identity using the same procedure, confirm whether the request is for a
personal workspace, selected data, or the account, and inventory affected personal
and shared business records before promising scope. Create a restricted manifest
of workspace/board IDs and media keys. Remove the email from the invite list and
restart API configuration so the account cannot simply register again.

A deletion operator must prepare a transaction reviewed against the current
schema: delete the requester's solely owned personal workspace (boards/items/assets
cascade), revoke account sessions and board/contact access, and replace the user
email/display name/avatar/password/Google identity with a unique anonymized
identity while setting `deleted_at`. Keep an anonymized user row where shared
history has foreign keys; never erase other users' business records to satisfy
one account request. Business ownership transfer and shared-record scope must be
agreed before deletion. This is operator work, not a public deletion endpoint.

Remove manifested objects only after confirming no remaining asset or preview
references use them. Explain whether media must be retained in backups until the
14-day backup window ends; record a deletion ledger outside the restored database
and reapply it before bringing a restored service online. Confirm old credentials,
sessions and links fail, affected boards are gone, remaining shared boards work,
and media has reached the agreed retention deadline. Record completion and reply
to the requester. Do not describe an item moved to Trash as permanently deleted.

## Rollback and handoff

Keep the previous immutable image and its configuration securely. For an
application-only rollback, set `RELEASE_IMAGE` to that previous tag, confirm
`db:status` using the matching build, and run Compose up for API/worker/web/proxy
without rebuilding or reverting migrations. `bash scripts/beta-rollback.sh <previous-tag>` automates those steps. Check readiness and core capture.
This release adds no schema migration. Existing migration CLI deliberately refuses
production `revert` commands.

For future incompatible schema changes, stop writes/workers during maintenance,
take a tested matching database/media backup, and choose a forward repair or full
snapshot restoration with an explicit accepted data-loss window. Do not assume
an old image can read a new schema. If migration fails, stop rollout and preserve
the old image and backup; follow the recorded repair/restore plan.

Release notes: board renaming, personal-share guard, copyable client links, help
and beta notices, invitation-gated signup, production Docker startup, and browser
smokes. Known limits: no persistent capture drafts, personal sharing, automated
recovery/deletion, enforced total quota, or real-time collaboration. Use direct
observation for beta activation and return use: invited user creates a board,
saves an idea, and returns to it. Collect minimal feedback with permission.

Tag a private-beta release only after CI, deployed real-R2 acceptance, phone and
browser/device checks, backup restoration, support ownership, and alert delivery
are recorded. Do not label a repository-only verification as a launched beta.
