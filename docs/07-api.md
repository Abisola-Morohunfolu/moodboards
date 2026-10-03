# API

REST over HTTPS with JSON bodies. Board routes resolve the caller's board role first and return 404 when there is none. The "Needs" column names the permission from [05-access-control.md](05-access-control.md).

## Health

These routes exist in backend work unit 1. They require no authentication.

| Method | Path | Response |
|--------|------|----------|
| GET | `/health/live` | `200`, `{ "status": "ok" }` |
| GET | `/health/ready` | `200` when database and migration checks pass; otherwise `503` |

Readiness returns `status` and `checks` with `postgres` and `migrations`.
Each value is `ok` or `down`. A request has a two-second deadline. Responses do
not include connection details or database errors. These checks only read data.

The product routes below remain specifications for later work units.

## Auth and account

| Method | Path | Needs | Notes |
|--------|------|-------|-------|
| POST | `/auth/signup` | none | Creates a user and a personal workspace |
| POST | `/auth/login` | none | |
| POST | `/auth/logout` | signed in | |
| GET | `/me` | signed in | User, workspaces, roles |
| DELETE | `/me` | signed in | Anonymizes the account. 409 while the caller is the only owner of a workspace with other members |

## Workspaces, members, clients

| Method | Path | Needs | Notes |
|--------|------|-------|-------|
| GET | `/workspaces` | signed in | Workspaces the caller belongs to |
| POST | `/workspaces` | signed in | Creates a business workspace |
| PATCH | `/workspaces/:id` | workspace owner | Name, logo, brand colour |
| GET | `/workspaces/:id/members` | workspace member | |
| PATCH | `/workspaces/:id/members/:userId` | workspace owner | Change role. Writes `access.changed` on every board in the workspace |
| DELETE | `/workspaces/:id/members/:userId` | workspace owner | In a personal workspace, hands over or moves each board they solely own, per the leaving rules in access control. Then revokes their remaining participant rows with `revoked_on_leave`. Writes `access.changed` on every affected board |
| GET, POST | `/workspaces/:id/clients` | business owner or staff | |
| DELETE | `/clients/:id` | business owner or staff | Archives |
| POST | `/clients/:id/contacts` | business owner or staff | Returns the contact's link |
| DELETE | `/contacts/:id` | business owner or staff | Ends the link, revokes participant rows, clears name and email |
| GET | `/contacts/:id/link` | business owner or staff | Current link, rebuilt from `link_version` |
| POST | `/contacts/:id/new-link` | business owner or staff | Increments `link_version`, ending the old link |

## Invites

| Method | Path | Needs | Notes |
|--------|------|-------|-------|
| POST | `/workspaces/:id/invites` | workspace owner | `email`, `workspaceRole` |
| POST | `/boards/:id/invites` | `board.share` | `email`, `boardRole`, optional `workspaceRole` |
| GET | `/invites/:token` | none | What accepting grants, for the accept screen |
| POST | `/invites/:token/accept` | signed in | Creates memberships and upserts participant rows. Joining a workspace clears its `revoked_on_leave` revocations |
| POST | `/invites/:id/resend` | inviter or owner | New token, same invite, `expires_at` reset to 14 days from now |
| DELETE | `/invites/:id` | inviter or owner | Sets `revoked_at` |

## Boards and access

| Method | Path | Needs | Notes |
|--------|------|-------|-------|
| GET | `/workspaces/:id/boards` | workspace member | Only boards the caller resolves a role on |
| GET | `/me/boards` | signed in | Every board where the caller has a participant row and `resolveBoardRole` gives them a role, across workspaces. Finds boards joined by a board-only invite or a share link, and leaves out boards they can no longer open |
| POST | `/boards` | member of `workspaceId` | `workspaceId`, `title`, optional `kitId`, `sourceBoardId`, `itemIds`. Copied items follow the price rule of `/items/:id/copy` |
| GET | `/boards/:id` | `board.view` | Board, sections, modules, caller's role |
| PATCH | `/boards/:id` | `board.share` | Title, layout, currency |
| DELETE | `/boards/:id` | `board.delete` | Archives: the board becomes read-only and stops counting toward the plan's active boards. Writes `access.changed` |
| POST | `/boards/:id/unarchive` | `board.delete` | 409 when the plan's active board limit is reached. Writes `access.changed` |
| GET | `/boards/:id/access` | `board.share` | Participants, invites, general access, current share link |
| PATCH | `/boards/:id/access` | `board.share` | `generalAccess`, `workspaceDefaultRole`, `linkRole`, `showPricesTo`, `locked`. Writes `access.changed` |
| POST | `/boards/:id/access/new-link` | `board.share` | Increments `link_version`, ending the old link. Writes `access.changed` |
| POST | `/boards/:id/participants` | `board.share` | `contactId`, `role` of `viewer` or `approver`. The contact must belong to the board's client. Writes `participant.joined` |
| PATCH | `/boards/:id/participants/:pid` | `board.share` | Role, `expiresAt`. 409 when it would leave a personal board with no owner, now or when `expiresAt` passes. Writes `access.changed` |
| DELETE | `/boards/:id/participants/:pid` | `board.share` | Sets `revoked_at` and clears `revoked_on_leave`, so a later rejoin keeps the removal. 409 when it would leave a personal board with no owner. Writes `access.changed` |
| GET | `/share/:token` | none | Token is `<id>.<hmac>`. A share link starts a session for that board. A client link starts a contact session and lists the boards the contact was added to |
| GET | `/boards/:id/events?after=:seq` | `board.view` | Events with `board_seq` above the client's last applied seq, redacted for the role. Hidden events come back as `redacted` placeholders, so the range has no gaps. 410 when any seq in the range has been deleted |

## Sections and items

| Method | Path | Needs | Notes |
|--------|------|-------|-------|
| POST, PATCH, DELETE | `/boards/:id/sections[/:sid]` | `item.edit` | |
| GET | `/boards/:id/items` | `board.view` | Prices removed below `show_prices_to` |
| POST | `/boards/:id/items` | `item.create` | Client sends `id`. A repeat on the same board returns the existing item and writes no event. An id on another board returns 409 |
| PATCH | `/items/:id/position` | `item.move` | `x`, `y`, `zOrder`, `sectionId`. Last write wins, no version |
| PATCH | `/items/:id` | `item.edit` | Content fields. Requires `version`. 409 when stale |
| DELETE | `/items/:id` | `item.delete` | Soft delete |
| POST | `/items/:id/copy` | `board.view` on the source, `item.create` on the target | `toBoardId`. Creates a new asset row on the target board. Drops `price_cents` when the caller's source role is below `show_prices_to` |
| POST | `/boards/:id/assets/presign` | `item.create` | `mime`, `bytes`, checked against the plan's upload cap. Returns a PUT URL signed for that type and size, and the asset id |
| GET | `/assets/:id/url` | `board.view` | Signed URL, 5 minutes |
| POST | `/boards/:id/export` | `board.view` | Queues `export-pdf`, rendered for the caller's role. Below `show_prices_to` the PDF has no prices and no budget section |

## Modules

| Method | Path | Needs | Notes |
|--------|------|-------|-------|
| GET | `/boards/:id/modules` | `board.view` | Enabled modules and config |
| PUT | `/boards/:id/modules/:moduleId` | `board.modules` | Enable or change config. Also enables modules it `requires` |
| DELETE | `/boards/:id/modules/:moduleId` | `board.modules` | Disable, data kept. 409 while an enabled module requires it |
| POST | `/boards/:id/modules/approvals/decisions` | `item.decide`, and a decider under the board's config | `itemId`, `status`, `comment`. `comment` is required for `swap_requested`. 403 for anyone who is not a decider |
| GET | `/boards/:id/modules/budget` | `budget.view` | Caps, planned spend, and committed spend when approvals is on, computed per request |
| PUT | `/boards/:id/modules/budget/allocations` | `budget.edit` | Board and section caps. Writes `budget.changed` |
| POST, PATCH, DELETE | `/boards/:id/modules/checklist/tasks[/:tid]` | `item.edit` | DELETE sets `deleted_at` |
| PUT | `/boards/:id/modules/compare/scores` | `compare.score` | `itemId`, `criterion`, `score` |
| POST | `/boards/:id/modules/date-poll/options` | `item.edit` | |
| PUT | `/boards/:id/modules/date-poll/votes` | `poll.vote` | |
| PUT | `/boards/:id/modules/reactions` | `item.react` | `itemId`, `kind` |
| GET, POST | `/workspaces/:id/vendors` | workspace member | |

## Billing

| Method | Path | Needs | Notes |
|--------|------|-------|-------|
| POST | `/billing/checkout` | `board.view` on `boardId` for `board_pass`, workspace owner for `household` or `business` | `product`, plus `boardId` or `workspaceId`. 404 when the caller has no role on the board |
| POST | `/billing/portal` | workspace owner | Stripe customer portal |
| POST | `/webhooks/stripe` | Stripe signature | Records the event and applies the grant in one transaction. Skips when the event id is already recorded |

## WebSocket

Connect to `/ws?board=:id&after=:seq`. The gateway resolves the role on connect, caches it on the connection, and sends any events after `seq`. Every event carries its `board_seq`, so the client can spot a lost message.

| Direction | Message | Needs |
|-----------|---------|-------|
| Client to server | `cursor.move` | `board.view` |
| Client to server | `item.drag` | `item.move` |
| Server to client | Every `board_events` row, redacted for the role. Events the role may not see arrive as `redacted` with only their `board_seq` | |
| Server to client | `presence.update` | |
| Server to client | `session.ended` before a disconnect for lost access | |
