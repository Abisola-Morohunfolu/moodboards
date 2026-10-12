# MVP release checklist

Repository audit: 12 October 2026. This checklist follows the current general
board-making direction in `PRODUCT.md` and `docs/09-roadmap.md`. It does not revive
the superseded planner-first launch requirements or speculative paid plans.

The release target is a free web MVP: create an account, create a personal board,
collect images/links/notes, organize them, return to saved ideas, search, and
restore items. Existing business client sharing and approvals remain optional.

Unchecked items below distinguish implementation gaps from release verification
and operating decisions. Production infrastructure outside this repository was
not inspected; deployment and monitoring items need confirmation, not an
assumption that nothing exists.

## Already implemented

- Password signup/login/logout, cookie sessions, authentication rate limits,
  personal workspace onboarding, and business workspace creation.
- Boards, sections, notes, images, link previews, desktop canvas movement,
  zoom/pan, mobile grids, and light/dark themes.
- Paste/drop/multiple-image capture, validation, bounded progress queue, safe
  retries, permission-loss recovery, and navigation warnings.
- Workspace search with board/type filters and item navigation; non-expiring
  item trash and individual restoration.
- Business clients/contacts, board-specific viewer/approver links, expiry,
  rotation/revocation, approvals, rejection, swap requests, and planner feedback.
- Explicit database migrations, private media storage, durable media jobs,
  maintenance, health/readiness endpoints, and CI checks.

## Before a private MVP beta

### 1. Close two confirmed UI gaps

- [x] Add owner-facing board renaming and refresh the gallery/search caches.
  `PATCH /boards/:id` already accepts `title`, but the gallery/editor have no
  rename control. Board creation currently says "You can change it later."
- [x] Resolve the personal-board Share dead end. The editor shows Share to every
  owner, but `SharePanel` requires a business client. For this MVP, hide or clearly
  explain unavailable personal sharing; general sharing can remain deferred.
  Handle empty/loading/error client and contact lists in the business flow.
- [x] Provide a copyable link fallback when clipboard permission fails. Link
  assignment/rotation can succeed before `navigator.clipboard.writeText` fails;
  the user needs access to the resulting link without another mutation.

Evidence: `apps/web/src/routes/boards.tsx`,
`apps/web/src/features/board/Editor.tsx`,
`apps/web/src/features/board/SharePanel.tsx`,
`apps/api/src/features/boards/boards.controller.ts`.

### 2. Choose the beta account-support path

- [x] Define how invited users recover access if they forget their password.
  Password reset/change and email verification are absent. A small invited beta
  needs a documented identity-checked support path; public signup needs the
  self-service recovery work below.
- [x] Keep Google sign-in unadvertised unless its browser flow is completed.
  The backend supports Google, but the login page has no Google action and the
  callback returns JSON rather than returning the user to the app.

Evidence: `apps/web/src/routes/login.tsx`,
`apps/api/src/features/auth/auth.controller.ts`,
`docs/13-backend-accounts-workspaces.md`.

### 3. Establish a repeatable production deployment

- [ ] Choose/confirm hosting for the TanStack Start web server, NestJS API,
  media worker, Postgres, Redis, and private R2 bucket.
- [x] Add production start/deployment configuration for each app. The web
  `start` script currently uses `vite preview`; validate and document a production
  server/adapter for the emitted SSR build. Bind services appropriately for
  their deployment environment.
- [ ] Configure domains, HTTPS, production secrets, `VITE_API_URL`,
  `PUBLIC_API_URL`, `PUBLIC_WEB_URL`, allowed origins, and R2 CORS. Verify
  credentialed cookie requests using the actual web/API hostnames.
- [x] Configure the trusted reverse proxy so authentication rate limits use the
  intended client IP. Ensure access logs do not retain sensitive share tokens.
- [x] Automate build, migration-before-start, rollout, and application rollback.
  Document how to handle a schema change that cannot safely be rolled back.

Evidence: `apps/web/package.json`, `apps/web/vite.config.ts`, `.env.example`,
`apps/api/src/main.ts`, `apps/api/src/app.setup.ts`,
`docs/12-backend-foundation.md`, `docs/13-backend-accounts-workspaces.md`.
CI exists in `.github/workflows/backend.yml`; production app deployment
configuration was not found in the repository.

### 4. Protect saved work and operate the app

- [ ] Configure database backups and test a restore. Document media recovery and
  retention alongside database recovery so restored rows retain usable assets.
- [ ] Configure uptime/readiness checks and alerts for API/worker failure, Redis
  failure, stalled/failed jobs, database capacity, and storage growth/cost.
  Existing health endpoints and logging are useful foundations.
- [x] Define an operator procedure for exhausted image-processing jobs. Save
  retries already exist, but failed processing is a separate state and the UI
  currently reports "Image unavailable" without a reprocess action. A documented
  support/re-upload path is sufficient for a small beta.
- [x] Define beta access and usage limits. The existing 10 MiB per-file cap and
  20-entry in-memory queue do not limit total retained storage or API volume.
  Record that trash currently retains items and referenced media indefinitely.

### 5. Complete release verification

- [ ] Run the full repository checks on the release commit and confirm CI is green.
- [ ] Verify the deployed happy path with real R2: signup → personal board →
  notes/links/images → processing complete → arrangement → reload → search →
  trash → restore. Check private image URLs refresh while a board stays open.
- [ ] Complete real desktop drag/drop and physical-phone capture tests. The quick
  capture work unit explicitly leaves native drag gestures and mobile capture
  interactions for a manual device/browser pass.
- [ ] Verify Chrome, Safari, and Firefox; desktop/mobile; light/dark; keyboard
  navigation and movement; focus restoration; screen-reader labels; zoom and
  reduced-motion behavior. Fix any defects that prevent the core flow.
- [ ] Exercise session expiry, revoked access, network loss, partial upload
  failures, uncertain saves, concurrent edits, and reload/navigation warnings.
  Pending capture inputs intentionally do not survive reload.
- [ ] Regress the optional business path: client/contact assignment, copy/open
  link on another device, viewer versus approver behavior, price visibility,
  decisions, and expired/rotated/revoked links.
- [ ] Check representative large boards and multiple active users. Board item
  reads currently load all active items and the UI polls for changes; establish
  an acceptable supported size before deciding whether to add pagination,
  virtualization, or further limits.
- [x] Add a small repeatable browser smoke suite for the core release path.
  Current Jest end-to-end tests exercise HTTP, not browser interaction.

### 6. Prepare the beta handoff

- [x] Add a visible support/feedback route and concise guidance for first capture,
  supported image types, saved versus processing states, and unfinished inputs.
- [ ] Publish a privacy notice and terms appropriate to the chosen launch, and
  establish an account/data deletion request process. Neither public pages nor
  account deletion endpoints were found in this audit.
- [ ] Invite a small set of real board-makers, observe capture/organization/
  retrieval friction, and resolve core-flow failures before widening access.
  Record activation and return use through lightweight instrumentation or direct
  observation; no paid analytics platform is required.
- [ ] Write release notes, known limitations, the support owner, and the rollback
  procedure. Release notes and rollback commands are in the operations runbook;
  a named support owner and release version/tag still need to be recorded after
  launch acceptance.

## Execution evidence and remaining launch gates

Repository implementation is split into three stacked branches:

1. `codex/private-beta-ui`: board rename, personal-share guard, resilient business
   sharing, and visible beta help/privacy/terms drafts ([PR #15](https://github.com/Abisola-Morohunfolu/moodboards/pull/15)).
2. `codex/private-beta-operations`: invite-only production signup, identity-checked
   password recovery/session revocation, Node SSR startup, Docker/Compose,
   migration/rollout/rollback and backups ([PR #16](https://github.com/Abisola-Morohunfolu/moodboards/pull/16)).
3. `codex/private-beta-verification`: cross-browser smoke suite, test-service CORS,
   CI for stacked branches, forwarded-IP and recovery-race regression tests, and
   this evidence. The final layer includes fixes discovered during verification.

The deployment baseline is Docker; no host has been provisioned. Read
[the beta operations runbook](24-private-beta-operations.md) for exact setup,
backup/restore, media retention, monitoring, identity checks, failed-image
support, supported deletion, beta boundaries, and rollback commands.

Checked implementation entries do not certify a live service. Before invitations,
record the real hosting/domain/provider region, named support and backup operators,
monitored contact, final privacy/terms notices, off-host backup schedule plus
production restore/media test, alert delivery, and real-R2/device acceptance.
The support contact can use the existing invitation conversation until a monitored
mailbox is configured. Cohort boundaries are monitored, not automatic quotas.
Release version/tag is deliberately unassigned until launch gates are complete.

## Before unrestricted public signup

- [ ] Implement forgotten-password email delivery, expiring single-use reset
  tokens, a reset UI, and session revocation after a password reset/change.
- [ ] Add authenticated password change and an email verification strategy.
  Account linking and Google sign-in remain optional unless included in launch.
- [ ] Provide account deletion through self-service or a dependable supported
  request process, including a policy for retained trash/media and backups.
- [ ] Enforce total storage/usage quotas and sensible limits on costly write,
  upload-reservation, and public-link exchange operations. Authentication limits
  alone do not cover these operations.
- [ ] Revisit board archive/delete after beta usage. There is currently no board
  lifecycle endpoint or UI; item trash does not let a user remove an entire board.
  This is a recommended organization improvement, not an existing launch promise.

## Deliberately deferred

General personal-board sharing; account/team invitations; realtime collaboration;
notifications and automatic client-link emails; exports/PDF; persistent capture
drafts and offline saving; external capture/browser extensions/phone share
integrations; duplication, multi-select, bulk actions, undo; fuzzy/semantic/OCR
search; specialist kits/modules/budgets; billing and paid entitlements.

These are candidates for evidence-driven follow-up, not prerequisites for the
current MVP. General sharing becomes a prerequisite only if the launch promises
it; paid billing becomes one only if the launch charges users.

## Implementation validation — 12 October 2026

- Final local `pnpm check` passed: formatting, lint, package builds, TypeScript,
  21 unit suites / 177 tests, 15 integration suites / 131 tests, and 6 HTTP
  end-to-end suites / 48 tests. **356 automated repository tests passed.**
- Browser smoke acceptance on this Mac passed **11 scenarios** across Chromium,
  WebKit, and a mobile viewport, with four intentional skips for Chromium-only
  resilience/size cases. It uses the real API, Postgres, Redis, media worker, and
  signed browser uploads to disposable MinIO, not a mocked API or storage.
- Chromium verified pointer and keyboard movement, private image URL refresh,
  immutable retries after an uncertain save, navigation warnings, and a 200-item
  board while a second isolated account saves a note. Shared smokes cover rename,
  reload/search/trash/restore, lost sessions, policies, and clipboard-denied
  business links through rotation/revocation.
- Desktop/mobile light/dark screenshots were inspected; reduced-motion mode is
  included in the core smoke. Actual Safari, physical phones, native external
  drag/drop/paste, screen-reader and 200% zoom acceptance still require devices.
- Firefox's installed Playwright binary failed to launch on this Mac with
  "Could not find profile folder" before any page was opened. The Linux CI suite
  includes Firefox as a required engine alongside Chromium/WebKit/mobile; check
  the final branch's run before merging.
- Production Docker image built successfully twice, including the recovery-race
  fix. The Node SSR server ran unprivileged in a container and served help HTML.
  Compose validation and shell syntax checks passed. Live HTTPS/R2 worker rollout
  still requires operator environment values.
- A custom-format dump from disposable Postgres restored into a **separate**
  disposable Postgres 15 container. Counts matched: 37 users, 37 boards, 445
  items, 10 assets, and 6 migration records. All 10 ready images retained usable
  original and thumbnail objects in disposable MinIO. This proves the restore
  method; it does not certify a production backup schedule or R2 recovery.
- Support recovery and session revocation, a login racing recovery, invited
  signup/login behavior, and trusted versus spoofed forwarded IPs have automated
  regression coverage. No schema migration was needed.

## Original audit validation

- Formatting, lint, TypeScript checks, and all package builds passed.
- Unit tests: 21 suites, 176 tests passed. The initial sandbox run could not bind
  the HTTP test socket; the rerun with local socket access passed.
- Integration tests: 15 suites, 129 tests passed against disposable Postgres,
  Redis, and MinIO.
- HTTP end-to-end tests: 6 suites, 46 tests passed against those same disposable
  services. Total automated tests: 351 passed.
- Production infrastructure and real-device/browser acceptance were not verified
  by this repository audit.

## Suggested execution order

1. Fix rename/sharing/clipboard gaps and define the invited-beta support path.
2. Establish deployment, backups, alerts, usage boundaries, and support pages.
3. Complete staging/device/browser acceptance and invite beta users.
4. Use beta findings to prioritize public account recovery and operating limits.
5. Open public signup when the public-release checklist is satisfied.
