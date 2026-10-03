# Decisions

Each entry states the decision and the reason. Add a new entry when a choice closes off an alternative.

## Product

**D1. Launch for planners, not consumers.** Businesses pay monthly and are easy to reach in Facebook groups and on Instagram. Couples plan once.

**D2. One-time Board Pass for personal boards, subscription for businesses.** Personal planning is occasional, so a monthly charge churns. A household plan covers people with many boards.

**D3. No payments between users.** Cost splitting with real money needs Stripe Connect, identity checks, and dispute handling. Not worth it at this size.

**D4. Not an accessibility product.** The builder works at an accessibility company. A competing side project risks the employment agreement.

## Architecture

**D46. Discover an account's joined boards through `GET /boards`.** This returns
boards with an existing account participant identity that still resolves access.
The membership-filtered workspace list also discovers boards reachable through
workspace defaults and business-owner recovery. This replaces the previously
specified `/me/boards` route before any board API clients exist.

**D47. Board core events carry typed metadata, not note content or prices.**
Identifiers, content versions, and changed field names describe the mutation.
Future handlers load current state; future client delivery must apply role-based
serialization. Storing raw private note text or monetary amounts is unnecessary
for the initial outbox.

**D44. Use Postgres-backed opaque cookie sessions for account authentication.**
Routes are private by default through one global Nest guard, with explicit public
metadata for health and auth entrypoints. Seven-day sessions are checked against
current user status on each request; logout revokes immediately. This avoids JWT
refresh/rotation machinery in the first browser account flow. The authenticated
principal never substitutes for workspace or board authorization.

**D45. Support passwords and Google without automatic account linking.** Passwords
use asynchronous scrypt with a versioned encoding. Google uses the official library,
PKCE, nonce, and single-use browser-bound state. Google identity is keyed by its
subject, not email. A matching existing email requires the existing login method;
explicit linking, local email verification, and account recovery are later work.
Both signup methods create personal workspace ownership and a session atomically.


**D41. Build and test the backend setup first.** The first work unit includes the
API, shared contracts, database primitives, and explicit migrations. It uses
pnpm and a CommonJS build. NestJS 11 and TypeORM 0.3 support this build format.
The web app and worker follow in later work units.

**D42. Use one TypeORM connection pool per process.** Initialize it at startup
and close it at shutdown. Queries return connections to the pool. Transactions
use one connection until commit or rollback. Pool limits and timeouts prevent
unlimited connections and waits.

**D43. Migrations create the database schema.** The initial migration holds a
fixed copy of the full reference schema. Compose does not load that schema.
A new development volume preserves the previous volume and its data. Database
tests use a separate database with temporary storage. Health checks only read
database state.

**D39. Keep the web app, API, workers, and shared packages in one TypeScript monorepo.** The three runtimes deploy independently but change together often: a board event, job payload, or API response can affect all of them. One repository keeps those contracts atomic while the `apps` and `packages` boundaries prevent runtime concerns from becoming one application.

**D40. Use TanStack Start for the web app.** Its typed file-based router and full-stack React runtime fit the board and client-link experiences without coupling the frontend to Next.js conventions. NestJS remains the authoritative product API and WebSocket gateway.

**D5. Event outbox in Postgres.** The API writes a `board_events` row in the same transaction as each change. Modules react later, so a failing module never rolls back a user's change.

**D6. Wake the dispatcher with `LISTEN/NOTIFY`, poll as a fallback.** Polling alone delays module reactions and jobs by up to the poll interval.

**D7. Live moves over WebSockets, saved only on drop.** Writing every drag frame would flood the database.

**D20. One delivery row per event per target.** A single `dispatched_at` can't record that one module succeeded and another failed. `board_event_deliveries` lets each module and queue retry alone, with backoff. `fanned_out_at` marks an event whose rows exist, so fan-out never claims it again while a delivery waits. A delivery stops after 10 attempts, so no event stays open forever.

**D21. Event handlers are idempotent and read current state.** Delivery is at least once, and retries can run late or out of order. Handlers upsert or key inserts on a natural key, and load rows instead of trusting the payload. A key built from the event id can't seed several rows from one event, and it duplicates rows when the same fact recurs.

**D30. Clients catch up by a per-board sequence, not the global event id.** Global ids are assigned at insert and commit in any order, so a cursor on them skips late commits. `boards.event_seq` is incremented in the writing transaction. The row lock serializes a board's writes and makes `board_seq` commit in order with no gaps. Writes to one board are rare enough that the lock costs nothing in practice. Writers that touch several boards lock them in `id` order, so the locks never deadlock.

**D22. Live updates are published by the writer after commit, not by the dispatcher.** Open browsers update without waiting for module work. The dispatcher only feeds modules and job queues.

**D23. Dispatchers claim with `FOR UPDATE SKIP LOCKED`, without partitions.** Every instance claims events and deliveries from the same tables, and `SKIP LOCKED` keeps them apart. Partitions with advisory locks add a layer the target scale doesn't need. Deliveries are claimed separately, so one slow module never stalls fan-out. Dispatched events are deleted after 30 days, and clients catch up from their last `board_seq`.

**D24. Position is last write wins; content uses a version check.** A move must never fail because someone else edited the title. Only two edits to the same content conflict.

**D8. Client-generated item ids.** A phone with a weak signal retries saves safely. A repeated id is a no-op.

**D9. Money in integer cents.** Floats lose cents in sums and splits.

## Model

**D10. Kits are bundles of modules.** New kinds of plan need a kit file, not a migration. Build the module system only when the second kit arrives, so its shape comes from two real cases.

**D11. Modules own their tables and never reference another module's tables.** Turning a module off then touches nothing else. A module that needs another's data names it in `uses` and calls its `queries`, and only while that module is on, so it never reads data a disabled module has stopped maintaining.

**D12. `board_participants` is the one identity on a board.** Partners, staff, and client contacts all act through it, so no module handles "user or contact". People who get in through general access or the business owner rule get a row with `role` null on first open. The row gives them an identity for actions without granting access of its own. Anonymous link visitors have no row and can only view.

**D31. A signed-up client contact keeps one row; two existing rows are never merged.** Setting `user_id` on the contact row keeps the link and the account on one identity. Merging two rows would mean the core rewriting module tables, which D11 forbids. The case needs a contact who was also invited by email to the same board, which is rare.

**D13. Items are copied between boards, never shared.** Each board keeps its own history. A copied image gets its own asset row on the target board, pointing at the same stored object, because image access is checked on the asset's board.

**D25. Modules chain through their own events, or compute on read.** Approvals updates `approval_states` inside the decision request and writes `approval.state_changed`. Checklist listens to that event, so it never reads a state that is about to change. Budget stores only caps and computes totals per request, so it has no handler to fall behind.

## Access

**D14. Two levels of role: workspace and board.** A friend can view one board without seeing the household's other boards.

**D15. Links grant viewer or approver only.** A forwarded link must never let strangers edit.

**D16. No role returns 404, not 403.** A private board's existence never leaks.

**D17. A personal workspace owner has no automatic access. A business owner does.** "Only me" boards, such as a surprise gift, stay private from a partner. A business must recover boards when staff leave.

**D18. Role permissions live in code.** Four fixed roles do not need permission tables. Modules add permissions with a default role.

**D19. Access changes disconnect live sessions.** The gateway resolves roles again on `access.changed`, so revoking takes effect within a second.

**D26. The gateway caches each connection's role and redacts every outgoing message.** Resolving the role from the database for each drag frame would cost hundreds of queries a second per board. Only the gateway knows each connection's role, so it is the one place that strips prices and hides budget events. A hidden event still goes out as a `redacted` placeholder with its `board_seq`, because clients detect lost messages by gaps in the sequence.

**D32. Revoking a person blocks every way in.** A revoked or expired participant row overrides general access and links, so "remove" works on workspace and link boards too. Only a business owner keeps access, for recovery.

**D33. Every output drops prices the reader can't see.** Copying and exporting need only `board.view`, so without this a viewer could copy items to their own board, export a PDF, or read an email and see every price. Copies, PDF exports, and emails are all rendered for one person's role.

**D34. People are anonymized, never deleted.** Items, decisions, and events point at participant rows, so deleting a user or contact would either fail or erase a board's history. Clearing personal fields removes the personal data and keeps the record. Clients are archived for the same reason.

**D35. Leaving a workspace ends access to all its boards.** A partner or staff member who leaves keeps nothing, even boards they were invited to directly. Keeping those would leave an ex-partner as editor on a shared board with no visible reason. These revocations carry `revoked_on_leave`, so rejoining restores them without undoing revocations an owner made by hand.

**D37. Leaving a personal workspace takes your private boards with you.** The household owner has no automatic access (D17), so a revoked owner row would leave a board nobody can run. A board they solely own goes to another household member with editor or higher, or to the household owner when it is shared with the whole workspace. Otherwise it moves to the leaver's own personal workspace, with its open invites revoked so none carries a role into that workspace. Outsiders never inherit a household board, and a personal board can never lose its last owner.

**D36. Client contacts reach only boards they were added to.** One contact link covers every board for that client, so opening it must not grant access by itself. A planner adds the contact to each board, which keeps drafts for the same client hidden. Like a share link, a contact link can be forwarded, so its sessions are capped at approver (D15).

**D38. Archived boards are read-only.** The free plan caps active boards, so an archived board that still took edits would make the cap meaningless. Archiving caps every role at viewer, like a lock, and unarchiving checks the plan's limit.

**D27. Share and client links are rebuilt from an HMAC, not stored.** A stored hash can't be shown again, so the Share dialog could never offer "Copy link". `link_version` ends old links. Invites stay hashed because they are sent once.

## Payments and safety

**D28. Webhook grants run in one transaction with the event record.** Recording the event first and granting later loses the grant if the second step fails. Because the record and the grant commit together, a `stripe_events` row means the event was processed, and the handler skips on an id conflict.

**D29. The preview worker fetches through an egress filter.** It fetches any URL a user pastes, so it refuses private, loopback, link-local, and metadata addresses, checks every redirect, and caps time and size.

**D39. Authentication rate limits use Redis; sessions stay in Postgres.** Short-lived counters expire automatically and keep repeated authentication writes off the application database. Atomic increments share limits across API instances. Redis failures reject new authentication attempts with 503 after a bounded check; existing sessions and logout remain available through Postgres. Keeping sessions in Postgres preserves transactional signup and active-user validation without introducing cross-store session writes or cache invalidation.
