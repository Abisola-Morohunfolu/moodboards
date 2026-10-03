# Flows

Every flow follows the write path in [02-architecture.md](02-architecture.md). The API changes data and writes a `board_events` row in one transaction, publishes the event to Redis after commit, and the dispatcher delivers it to modules and job queues. The gateway redacts every live message for each connection's role.

| # | Flow | Writes |
|---|------|--------|
| 1 | Sign up and first board | `users`, `workspaces`, `workspace_members`, `boards`, `board_participants`, `board_events` |
| 2 | Save a link | `items`, `link_previews`, `board_events` |
| 3 | Upload an image | `assets`, `items`, `board_events` |
| 4 | Live sync | `items`, `board_events` |
| 5 | Invite your partner | `invites`, `workspace_members`, `board_participants`, `board_modules`, `board_events` |
| 6 | Share and revoke access | `boards`, `board_participants`, `board_events` |
| 7 | Approval | `board_participants`, `approval_decisions`, `approval_states`, `checklist_tasks`, `board_events` |
| 8 | Board Pass payment | `stripe_events`, `purchases`, `boards`, `board_events` |
| 9 | New board from a template | `boards`, `sections`, `board_modules`, `assets`, `items`, `board_participants`, `board_events` |

Every flow that reaches the dispatcher also writes `board_event_deliveries`.

## 1. Sign up and first board

```mermaid
sequenceDiagram
  autonumber
  actor U as New user
  participant API
  participant DB as Postgres
  U->>API: POST /auth/signup
  API->>DB: insert users
  API->>DB: insert workspaces type=personal and workspace_members role=owner
  API-->>U: signed in, lands on the board list
  U->>API: POST /boards personal workspaceId, title
  API->>DB: insert boards kit_id=blank, layout=canvas
  API->>DB: insert board_participants for the creator, role owner
  API->>DB: insert board_events board.created
  API-->>U: 201 empty canvas
  Note over API,DB: No modules are enabled, so the dispatcher has no deliveries to make
```

## 2. Save a link

Saves from the share sheet or extension land in Unsorted on the last board used.

```mermaid
sequenceDiagram
  autonumber
  actor U as Ada, phone
  actor L as Ada, laptop
  participant API
  participant DB as Postgres
  participant R as Redis
  participant D as Dispatcher
  participant W as Preview worker
  participant GW as WS gateway
  U->>API: POST /boards/:id/items id, kind=link, url
  API->>DB: insert link_previews by url_hash if missing, status pending, leave an existing row unchanged
  API->>DB: insert items with section_id null, skip if id exists on this board
  API->>DB: insert board_events item.created, only if the item row was inserted
  API->>R: after commit, publish item.created
  API-->>U: 201 saved to Unsorted
  R->>GW: fan out
  GW-->>L: card appears on the laptop
  DB-->>D: NOTIFY
  D->>DB: insert board_event_deliveries for fetch-preview
  D->>W: enqueue fetch-preview if missing or expired
  W->>W: fetch through the egress filter, read Open Graph and JSON-LD
  W->>DB: link_previews ready, board_events preview.ready on every board using it
  W->>R: publish preview.ready to each board
  GW-->>L: card shows title and image
```

A board that saves the same URL while a fetch is pending enqueues nothing. It still gets `preview.ready`, because the worker writes one on every board with a live item that uses the preview.

The same item id saved again on the same board is a no-op that returns the existing item. An id that exists on another board returns 409.

## 3. Upload an image

```mermaid
sequenceDiagram
  autonumber
  actor U as Designer
  participant API
  participant S3 as Object storage
  participant DB as Postgres
  participant R as Redis
  participant D as Dispatcher
  participant W as Image worker
  U->>API: POST /boards/:id/assets/presign mime, bytes
  API->>API: check bytes against the plan's upload cap
  API->>DB: insert assets, status pending
  API-->>U: PUT URL signed for that type and size, and the asset id
  U->>S3: PUT original file
  U->>API: POST /boards/:id/items kind=image, assetId
  API->>DB: insert items and board_events item.created
  API->>R: after commit, publish item.created
  D->>W: deliver to process-image
  W->>S3: read original, write thumbnail
  W->>DB: assets ready with palette, board_events asset.ready
  W->>R: publish asset.ready
```

## 4. Live sync

The same path keeps two people, or one person on two devices, in step.

```mermaid
sequenceDiagram
  autonumber
  actor A as Tolu
  actor B as Ada
  participant GW as WS gateway
  participant R as Redis
  participant API
  participant DB as Postgres
  A->>GW: item.drag, throttled to 20 per second
  GW->>GW: check the cached role has item.move
  GW->>R: publish to board channel
  R->>GW: fan out to every gateway instance
  GW-->>B: card and cursor move live
  A->>API: PATCH /items/:id/position x, y, z_order
  API->>DB: update position fields, last write wins
  API->>DB: insert board_events item.moved
  API->>R: after commit, publish item.moved
  A->>API: PATCH /items/:id title, version 7
  alt version still 7
    API->>DB: update content, version 8, board_events item.updated
    API-->>A: 200 with version 8
  else someone edited the content first
    API-->>A: 409 with the current item
  end
```

A move never conflicts with a content edit. Only two content edits on the same item can conflict.

## 5. Invite your partner

```mermaid
sequenceDiagram
  autonumber
  actor A as Ada
  actor T as Tolu
  participant API
  participant DB as Postgres
  participant D as Dispatcher
  participant GW as WS gateway
  A->>API: POST /boards/:id/invites email, workspaceRole=partner, boardRole=editor
  API->>DB: insert invites with a token hash, expires in 14 days
  API-->>A: 201, invite email queued
  T->>API: POST /invites/:token/accept
  API->>DB: insert workspace_members role=partner
  API->>DB: upsert board_participants role=editor, clearing any revocation or expiry
  API->>DB: invites accepted_at, board_events participant.joined
  API->>DB: personal board now has 2 participants, upsert board_modules reactions, board_events module.enabled
  GW-->>A: Tolu appears, prompt to turn on approvals
```

## 6. Share and revoke access

```mermaid
sequenceDiagram
  autonumber
  actor O as Owner
  actor V as Friend with link
  participant API
  participant DB as Postgres
  participant R as Redis
  participant GW as WS gateway
  O->>API: PATCH /boards/:id/access general_access=link, link_role=viewer
  API->>DB: update boards, insert board_events access.changed
  API-->>O: current link, rebuilt from link_version
  V->>API: GET /share/:token
  API->>API: check the HMAC, resolveBoardRole gives viewer
  API-->>V: board, prices removed below show_prices_to
  V->>GW: open live connection, role cached as viewer
  O->>API: POST /boards/:id/access/new-link
  API->>DB: link_version + 1, insert board_events access.changed
  API->>R: after commit, publish access.changed
  R->>GW: access.changed for this board
  GW->>GW: resolve roles again for every open connection
  GW-->>V: session.ended, disconnected
  V->>API: GET /share/:old-token
  API-->>V: 404 Not found
```

## 7. Approval

The approvals route updates the state inside the request. Checklist reacts to the state change, not to the raw decision, so it never reads a stale state. Budget computes committed spend on read, so it needs no event.

```mermaid
sequenceDiagram
  autonumber
  actor P as Planner
  actor C as Client contact
  participant API
  participant DB as Postgres
  participant R as Redis
  participant D as Dispatcher
  participant CL as Checklist
  participant GW as WS gateway
  P->>API: POST /boards/:id/participants contactId, role=approver
  API->>DB: check the contact belongs to the board's client
  API->>DB: insert board_participants with contact_id, board_events participant.joined
  C->>API: GET /share/:token
  API->>DB: find client_contacts by id, check the HMAC
  API-->>C: contact session, boards the contact was added to
  C->>API: POST /boards/:id/modules/approvals/decisions itemId, status=approved
  API->>DB: upsert approval_states and lock it FOR UPDATE
  API->>DB: insert approval_decisions
  API->>DB: apply the board rule to each decider's latest decision, update approval_states
  API->>DB: insert board_events item.decided and approval.state_changed
  API->>R: after commit, publish both
  API-->>C: 201 with the new state
  D->>DB: insert board_event_deliveries for checklist
  D->>CL: approval.state_changed
  CL->>DB: insert checklist_tasks Pay deposit, source_key deposit:item_id, skip if it exists
  GW-->>C: progress updates
```

`approval.state_changed` is written only when the core state changes. With the `all` rule, the first of two approvals writes `item.decided` only. The row lock means two approvals sent at once still end with the item approved.

Opening the link creates no rows. A contact reaches only the boards a planner added them to, so draft boards for the same client stay hidden.

## 8. Board Pass payment

```mermaid
sequenceDiagram
  autonumber
  actor U as Couple
  participant API
  participant DB as Postgres
  participant S as Stripe
  participant R as Redis
  participant GW as WS gateway
  U->>API: POST /billing/checkout product=board_pass, boardId
  API->>S: create Checkout session
  API->>DB: insert purchases, status pending
  API-->>U: redirect to Stripe
  U->>S: pay
  S-->>U: redirect back, page shows Confirming payment
  S->>API: webhook checkout.session.completed
  API->>DB: begin
  API->>DB: insert stripe_events id on conflict do nothing
  alt row already existed
    API->>DB: rollback
    API-->>S: 200, already handled
  else inserted
    API->>DB: purchases paid, boards.upgraded_at, board_events board.upgraded
    API->>DB: commit
    API->>R: after commit, publish board.upgraded
    API-->>S: 200
  end
  GW-->>U: limits removed
```

If anything fails before commit, nothing is recorded and Stripe's retry runs the whole grant again. A duplicate delivery that arrives during the first one waits on the id conflict, then skips once the first commits. Business and household plans follow the same path. The webhook writes `subscriptions`, and `customer.subscription.updated` keeps `status` and `current_period_end` current.

## 9. New board from a template

```mermaid
sequenceDiagram
  autonumber
  actor U as Household
  participant API
  participant DB as Postgres
  participant D as Dispatcher
  U->>API: POST /boards workspaceId, title, sourceBoardId, itemIds
  API->>API: check board.view on the source and membership of workspaceId
  API->>DB: insert boards with source_board_id
  API->>DB: copy sections
  API->>DB: copy board_modules with config
  API->>DB: for each image item, insert assets on the new board with the same storage_key
  API->>DB: copy chosen items with copied_from_item_id and the new asset ids, prices only if the caller's source role meets show_prices_to
  API->>DB: insert board_participants for the creator, board_events board.created and item.created per copied item
  API-->>U: 201 new board
  D->>DB: deliver board.created, each module seeds its own data keyed by source_key
  D->>DB: deliver item.created, process-image for any copied asset still pending
```

Copying one item with `POST /items/:id/copy` follows the same asset and price rules.
