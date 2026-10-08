# Roadmap

## Direction

General board-making comes first. Preserve the existing client workflow as an
optional capability. This replaces the earlier planner-first phases,
paying-planner launch gates, specialist kit sequence, and speculative pricing.
New features should follow evidence from using boards, without requiring a
particular use case to materialize.

## Completed foundation

Accounts and personal/business workspaces, board core, media workers, client
access, web canvas/mobile grid, versioned approvals, shared database mappings,
and client approval controls are implemented (work units 1–9).

## Work unit 10: quick capture

See [requirements and diagrams](21-web-quick-capture.md).

1. Shared in-memory capture queue, text/URL interpretation, explicit text
   composer, progress tray, safe retries, and personal workspace default.
2. Image paste/drop, multiple-image selection, per-file validation, canvas
   placement, navigation warnings, and desktop/mobile verification.

Exit: collect several items without repeated dialogs; partial failures preserve
successful saves; uncertain retries create no duplicates; processing states are
separate from save confirmation. Existing client approvals remain functional.

## Evaluate after use

Record friction in collecting, arranging, revisiting, and sharing real boards.
Select the next bounded improvement from those observations. Potential work:
organization and recovery, general sharing, cross-board capture, external
capture, export, and only then optional specialist capabilities or billing if
there is evidence for them. These are candidates without dates or revenue gates.
