# Backend work unit 7: client approvals and swap requests

Approvals are available on business boards associated with a client. Every live
item starts pending. Only a live contact assignment with `approver` role can
decide; viewer contacts can read aggregate states. Account sessions never grant
decision rights, including when an account and contact cookie are both present.
The first version uses a fixed `all` rule. Generic module enablement, personal
board decisions, and web controls follow later.

## HTTP contracts

| Method | Route | Access | Result |
|--------|-------|--------|--------|
| GET | `/boards/:id/approvals` | Account with `item.edit` | Every live item's state and each contact's latest decision for that item version, including name and comment |
| GET | `/client/board/approvals` | Bound contact session | Every live item's state and only this contact's latest decision |
| POST | `/client/board/approvals/decisions` | Bound approver session | 201 for a new decision, 200 for an identical ID retry |

The decision body is `{ id, itemId, itemVersion, status, comment? }`. `id` is a
client-generated UUID. Status is `approved`, `rejected`, or `swap_requested`.
Swap requests require a trimmed comment of 1–2000 characters. A reused ID with
different content, a stale item version, or a decision on an approved version
returns 409. An item on another board or a deleted item returns 404. Board
lock/archive caps the contact at viewer, so decisions return 403. Responses use
camelCase, UTC timestamps, and `Cache-Control: no-store`.

For a pending or rejected item, each current approver's latest decision on the
current item version counts. Any swap request wins over a rejection for the
display status; either maps to core state `rejected`. Otherwise, all current
approvers must approve; with no approvers, the item remains pending. A completed
approval is frozen for that item version: a newly assigned approver does not
reopen it, and further decisions return 409.

Content, price, or quantity patches increment the item version and reset its
approval state to pending in the same transaction. Position changes leave it
alone. A planner addresses a swap by editing that item or creating a replacement;
deleted items disappear from approval reads. Decisions on older versions remain
in history but do not count in the current round.

Every decision writes `item.decided`. Core-state changes write
`approval.state_changed`; payloads contain item IDs, versions, and core state,
never names or comments. The board row serializes decisions, content edits, and
assignment changes. Pending/rejected states reconcile on assignment changes and
approval reads, so expiries are reflected when a board is next read. Approved
states remain frozen. Decision UUIDs and result snapshots make retries
idempotent even after a later item edit.

The additive migration adds version and result columns to the existing approval
tables. Apply it before starting the updated API. The reference schema and
migration parity tests are updated together.
