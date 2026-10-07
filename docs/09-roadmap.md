# Roadmap

Implementation note: backend work units 1–5 and 7 and web work unit 6 are
complete. Backend work unit 8 adds shared entity mappings and query builders
across the API and worker; see [database cleanup](19-backend-database-mapping.md).
Web approval controls, budget, export, and billing follow.

Estimates assume one full-stack developer working part time, about 15 hours a week.

## Phase 0: validate, 2 weeks

- Interview 15 planners about client approvals.
- Show a clickable mockup to the 5 or more who say it hurts.
- Pre-sell the first month to 3 of them.

Exit: 3 paying planners. Without them, change the idea.

## Phase 1: planner MVP, 8 weeks

- Auth, business workspaces, clients, client contacts.
- Boards with the `events` kit, canvas layout, sections.
- Items: note, image upload, link with preview.
- Client links with approve or swap. Approvals and budget are built in, not yet modules.
- PDF export, business subscription with Stripe.

Exit: 10 paying planners.

## Phase 2: collaboration and second kit, 6 weeks

- Live sync, presence, and version checks on drop.
- Full sharing and roles: `board_participants`, general access, invites, revocation.
- The `interior` kit with grid layout. Pull approvals, budget, and vendors out into modules now that two kits use them.
- Event outbox with `LISTEN/NOTIFY`.

Exit: 35 paying workspaces, about $1,000 a month.

## Phase 3: personal boards, 6 weeks

- Personal workspaces, `blank` kit, Unsorted.
- Quick save from the phone share sheet and a browser extension.
- Partner invites, automatic reactions, approval offers.
- Board Pass with one-time Checkout.

## Phase 4: life planning, 8 weeks

- Kits: `moving`, `house-hunting`, `date-night`.
- Modules: checklist, compare, map, date poll.
- Templates and copying items between boards.
- Household plan.

## Later

- Affiliate links on product and vendor items.
- Price and stock tracking across stores.
- Vendor listings and leads.
