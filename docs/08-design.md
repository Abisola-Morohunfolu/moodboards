# Design

Wireframes, type, and colour live on one canvas: https://claude.ai/artifact/DSFkKS2UPRPbao4a1ncq5o

## Principle

Boards are full of photos, swatches, and links that bring their own colour. The app around them stays calm: one accent, soft neutrals, and status colours that differ in lightness as well as hue.

## Type

| Role | Font | Weights | Use |
|------|------|---------|-----|
| Display | Bricolage Grotesque | 500, 700 | Board titles, page headings |
| UI and body | Instrument Sans | 400, 500, 600 | Everything else. Tabular numbers for prices |

Both are free on Google Fonts.

Alternatives:
- Young Serif with Figtree: warmer, if couples become the main audience.
- Hanken Grotesk with Newsreader italic titles: editorial, for interior design studios.

## Colour: Plum and linen

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `accent` | #6B3B5E | #D9A6CB | Primary button, selection, links |
| `accent-tint` | #F1E6EE | #3A2535 | Selected rows, badges |
| `ink` | #221B26 | #ECE7EE | Text |
| `ink-muted` | #6D6373 | #A99FAE | Secondary text |
| `ground` | #F7F5F8 | #17141A | App background |
| `surface` | #FFFFFF | #1F1B23 | Cards, panels, dialogs |
| `line` | #E4DEE8 | #342D39 | Borders, dividers |

Alternatives on the canvas: Navy and marigold (businesslike, for designers) and Sage and blush (soft, for weddings).

### Status colours

Shared by every palette. Pale fill with dark text from the same hue, at least 4.5:1. The pill text always names the status.

| Status | Text | Fill |
|--------|------|------|
| Approved | #1F5240 | #DCEFE6 |
| Proposed | #7A4E0E | #F7ECD9 |
| Swap asked | #8F2F28 | #F8E2DF |
| Ordered | #2B4C7E | #E2EAF6 |

## Screens

| Screen | Purpose | Key parts |
|--------|---------|-----------|
| Boards home | Find and start boards | Workspace switcher, board grid with access labels, template card |
| Board canvas | Build the board | Section tabs with Unsorted, add tools, live cursors, module panel |
| Board grid | Rooms and products | Same as canvas, grouped by section, kit fields on each card |
| Share and roles | Control access | People with roles, invites, general access, link role, new link, show prices to, lock |
| Quick save (phone) | Save from any app | Board and section pickers, note, works offline |
| Client approval (phone) | Decide item by item | Progress, item, comment, Approve or Ask for a swap, no account |
| Accept invite (phone) | Join a board | What joining grants, sign in, join |

## UI rules

1. One filled accent button per screen. Everything else is outlined or plain.
2. Touch targets are at least 44 px.
3. Status is always text plus colour, never colour alone.
4. Personal workspaces never show the words workspace, kit, or module.
5. Empty states name what will appear and how to add the first item.
