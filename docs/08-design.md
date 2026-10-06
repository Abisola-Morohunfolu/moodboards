# Design

The approved visual direction is a quiet canvas: Instrument Sans, neutral surfaces,
one restrained blue accent, and images that lead. The Moodboard name and asterisk
mark remain. [DESIGN.md](../DESIGN.md) is the canonical extracted visual system;
the implemented tokens in `apps/web/src/styles/app.css` govern the running app.
The companion `.impeccable/design.json` supplies live component examples and
extensions for motion, elevation, and breakpoints.

Earlier wireframes remain at https://claude.ai/artifact/DSFkKS2UPRPbao4a1ncq5o
as historical references, not the current palette or type specification.

## Principle

Boards are full of photos, swatches, and links that bring their own colour. The app around them stays calm: one accent, soft neutrals, and status colours that differ in lightness as well as hue.

## Type

| Role | Font | Weights | Use |
|------|------|---------|-----|
| Display and headings | Instrument Sans | 600 | Landing headline, page and board titles |
| UI and body | Instrument Sans | 400, 500, 600 | Controls and copy. Tabular numbers for prices |

Instrument Sans is self-hosted as a variable Latin WOFF2 font at
`apps/web/public/fonts/instrument-sans-latin.woff2`, with weights 400–700 and
font-display swap. The app makes no Google Fonts request.

## Colour: semantic light and dark

| CSS role | Light | Dark | Use |
|----------|-------|------|-----|
| `--brand` | #315BD8 | #8AA9FF | Primary button, selection, focus, links |
| `--brand-hover` | #2449BB | #A3BBFF | Primary hover |
| `--brand-text` | #FCFDFE | #16213B | Text on primary actions |
| `--foreground` | #20242B | #E9EDF3 | Text |
| `--secondary` | #626B78 | #A7B0BC | Supporting text |
| `--background` | #F7F8FA | #14171C | App background |
| `--subtle` | #EDF0F4 | #272E38 | Insets, selection rows, skeletons |
| `--surface` | #FCFDFE | #1C2128 | Cards, fields, tools, dialogs |
| `--border` | #D9DDE5 | #353D49 | Borders and dividers |
| `--danger` | #A63138 | #FFB2BA | Error and destructive-action text |
| `--danger-surface` | #FCEBED | #3C242C | Error fill |

The default theme follows `prefers-color-scheme`. The compact theme control
cycles system, light, and dark, persisting the choice as `moodboard-theme` in
local storage. Tailwind aliases such as paper, cream, ink, and line resolve to
the semantic roles above; they do not describe a paper palette. Dots appear
only on the real desktop canvas, at a 24px pitch. Entry screens are plain.

## Shape, focus, and motion

Controls and fields use an 8px radius, cards and panels 12px, dialogs 16px.
Cards are flat with quiet borders; floating tools and native dialogs use shadows.
Keyboard focus uses a 3px accent outline with 3px offset. Dialogs call
`showModal`, handle Escape/backdrop dismissal, and restore prior focus on close.
Mobile inspectors and create-item forms become bottom sheets. Buttons use small
hover/press feedback; skeleton breathing is disabled by reduced-motion preference.
Errors and media-processing states always include readable text.

## Screens

| Screen | Purpose | Key parts |
|--------|---------|-----------|
| Public landing | Introduce collection and start signup | Full page, labeled example board and imagery, truthful capability copy |
| Boards home | Find and start boards | Workspace switcher, board grid, create board |
| Board canvas | Build the board | Section tabs with Unsorted, add tools, card inspector, desktop movement |
| Mobile board grid | Build the board on a phone | Section navigation, notes/images/links, inline add tools, inspector sheet |
| Share and roles | Control contact access | Client association, board-specific contacts, expiry, link rotation and revocation |
| Client viewer | Read shared board on a phone | Section tabs, images, notes, links, prices when allowed |

The landing examples use generated photos and are explicitly labeled as examples.
The signed-in gallery derives previews from actual authorized board content.
Quick save/offline capture, client approvals and swap requests, invitation
acceptance, kits, budgets, and billing remain future surfaces; they are not
current UI or marketing claims.

## UI rules

1. Keep the blue accent restrained and tied to meaningful actions or state.
2. Touch targets are at least 44 px.
3. Status is always text plus colour, never colour alone.
4. Show business client controls only where the workspace and role permit them.
5. Empty states name what will appear and how to add the first item.
