# Modules and kits

A **module** is one self-contained feature: approvals, budget, checklist, map. A **kit** is a starting bundle of modules plus labels and an export layout for one kind of plan. A board starts from a kit, then turns modules on or off freely.

## Core versus module

| Core, shared by every board | Module or kit |
|-----------------------------|---------------|
| Workspaces, members, clients, invites | Labels such as "Event / Moment" or "Concept / Room" |
| Boards, sections, items, positions | Item kinds and their fields |
| Price, quantity, image, link | Approval steps such as `booked` or `ordered` |
| Participants, roles, sharing | Section presets such as "Ceremony" or "Kitchen" |
| Billing, export engine, event outbox | Export layout |

A field becomes a core column only when every kit uses it.

## Module interface

```ts
export interface BoardModule<Config = unknown> {
  id: string;
  requires?: string[];
  uses?: string[];
  queries?: Record<string, (boardId: string, ctx: ModuleContext) => Promise<unknown>>;
  configSchema: z.ZodType<Config>;
  itemKinds?: Record<string, ItemKindDef>;
  permissions?: Record<string, BoardRole>;
  ui: {
    boardPanel?: Component;
    itemBadge?: Component;
    itemTab?: Component;
    exportSection?: Component;
  };
  onEvent?: (event: BoardEvent, ctx: ModuleContext) => Promise<void>;
}
```

`permissions` maps each permission the module adds to the lowest role that holds it by default, for example `{ 'checklist.assign': 'editor' }`.

`requires` names modules that must be on. Turning a module on also turns on what it requires, in the same transaction. Turning off a module that another enabled module requires returns 409. `uses` names modules this one reads when they are on, through their `queries`. Budget uses approvals: with approvals on, it shows committed spend from `approvals.queries.coreStates`; with approvals off, it shows planned spend only.

## Rules

1. The core never imports a module. It writes events, and modules react through `onEvent`.
2. A module owns its tables and its routes under `/boards/:id/modules/:moduleId`. Another module reads its data only through its `queries`, and only while it is on.
3. Item kinds are registered by modules. Creating an item of a kind needs that module on. The kind's schema stays registered when the module is off, so existing items still validate and stay editable. Copying an item to a board without its module returns 409 naming the module.
4. Modules fill fixed UI slots: board panel, item badge, item tab, export section. They never rearrange core screens.
5. A new kit that needs a migration means kit-specific logic leaked into the core.

## Event handlers

- A delivery can run more than once, so `onEvent` must be idempotent: upsert, or key inserts on a natural key such as `deposit:<item id>`.
- Load current rows from the database. Never trust the event payload or event order for state.
- When a module's result feeds another module, the first module writes its own event and the second listens to it. Two modules never react to the same event when one depends on the other's write.

## Module catalogue

| Module | Tables | Item kinds | Listens to | Adds permission |
|--------|--------|-----------|------------|-----------------|
| `approvals` | `approval_states`, `approval_decisions` | none | `participant.joined`, `access.changed` | `item.decide` |
| `budget` | `budget_allocations` | none | none, computes totals on read | `budget.view`, `budget.edit` |
| `vendors` | `vendors`, `item_vendors` | `service` | `item.deleted` | `vendors.edit` |
| `checklist` | `checklist_tasks` | none | `approval.state_changed`, `board.created`, `module.enabled` | `checklist.assign` |
| `compare` | `compare_scores` | `listing` | `item.deleted` | `compare.score` |
| `date-poll` | `date_poll_options`, `date_poll_votes` | none | none | `poll.vote` |
| `reactions` | `reactions` | none | none | `item.react` |
| `map` | none, reads `lat` and `lng` from `items.attributes` | `place` | none | none |

`compare` requires `reactions`.

A module that seeds data does it on `board.created` when a kit turns it on, and on the `module.enabled` event that names that module when someone turns it on later. Both seed through the same natural keys, so neither path duplicates the other. Seeded rows are soft-deleted (`checklist_tasks.deleted_at`), so their key stays taken and a starter task someone deleted never comes back.

## Approval states

Each kit defines its own statuses and maps each to one core state. Core screens, counts, and notifications use only the core state.

| Kit status | Core state |
|-----------|------------|
| `proposed` | `pending` |
| `approved`, `booked`, `ordered`, `delivered` | `approved` |
| `rejected`, `swap_requested` | `rejected` |

`swap_requested` is the client's "Ask for a swap". It requires a comment saying what to change. The planner answers by replacing the item, and the new item starts pending.

The board's approval rule lives in the module config. Each rule reads every decider's latest decision, mapped to its core state:

| Rule | Approved | Rejected | Otherwise |
|------|----------|----------|-----------|
| `any` | Any decider approved | None approved and any decider rejected | Pending |
| `all` | Every decider approved | Any decider rejected | Pending |

With no deciders, every item stays pending under either rule.

`approval_states.status` takes the kit status of the latest decision with the resulting core state, so a swap request shows as `swap_requested`.

Who decides comes from the workspace type, not the kit, so any kit works in either kind of workspace:

| Workspace | Deciders |
|-----------|----------|
| Business | Client contacts with `approver` |
| Personal | Everyone at `approver` or above (owner, editor, approver) |

A decider is a participant whose own row sets a qualifying role and is not revoked or expired. People who reach the board only through general access have a row with `role` null, so they never count, however often they open the board. To make one a decider, an owner gives them a role on the board.

Only deciders can decide. The decisions route returns 403 to anyone else, even with `item.decide`, and the app hides Approve and Ask for a swap from them.

A decision is handled by the approvals route, inside the request's transaction. In one commit it:

1. Upserts the item's `approval_states` row and locks it with `FOR UPDATE`. An item with no row is pending.
2. Inserts `approval_decisions`.
3. Applies the rule to each current decider's latest decision and updates `approval_states`.
4. Writes `item.decided`, plus `approval.state_changed` when the core state changes.

The lock makes concurrent decisions on one item run one at a time, so the `all` rule never misses an approval. Checklist reacts to `approval.state_changed`, so it always sees the new state. Budget reads core states on each request.

When deciders change (`participant.joined`, `access.changed`), the module applies the rule again to pending items under the same lock. A removed decider no longer blocks `all`.

## Kits

| Kit | Layout | Labels | Modules on at start |
|-----|--------|--------|---------------------|
| `blank` | canvas | Board, Section | none |
| `events` | canvas | Event, Moment, Couple | approvals, budget, vendors, reactions |
| `interior` | grid | Concept, Room, Client | approvals, budget, vendors |
| `moving` | grid | Move, Room | budget, checklist, vendors |
| `house-hunting` | grid | Search, Area | budget, compare, reactions, map, date-poll, checklist |
| `date-night` | canvas | Date, Idea | map, date-poll, reactions |

Personal workspaces use a second label set: "Your wedding" in place of "Okafor wedding", "Each other" in place of "Couple".

## Kit definition example

```ts
export const interiorKit = defineKit({
  id: 'interior',
  layout: 'grid',
  labels: { board: 'Concept', section: 'Room', client: 'Client' },
  sectionPresets: ['Living room', 'Kitchen', 'Primary bedroom'],
  itemKinds: {
    product: {
      label: 'Product',
      fields: z.object({
        sku: z.string().optional(),
        dimensions: z.string().optional(),
        finish: z.string().optional(),
        leadTimeWeeks: z.number().int().optional(),
      }),
    },
    material: { label: 'Material', fields: z.object({ material: z.string(), colour: z.string() }) },
  },
  modules: {
    approvals: {
      rule: 'any',
      statuses: {
        proposed: 'pending',
        approved: 'approved',
        ordered: 'approved',
        delivered: 'approved',
        rejected: 'rejected',
        swap_requested: 'rejected',
      },
    },
    budget: {},
    vendors: {},
  },
  exportTemplate: 'room-by-room',
});
```

## Personal boards

- The `blank` kit is the default. "New board" opens an empty canvas with no kit picker.
- Modules appear later as offers: "Add a budget", "Invite your partner".
- When a second participant with a role joins, the API turns on `reactions` in the same transaction and writes `module.enabled`, then the app offers `approvals`. Rows with `role` null don't count. This lives in the core join path, because a module that is off receives no events and can't turn itself on.
