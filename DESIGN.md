---
name: Moodboard
description: A quiet canvas for images, links, and notes.
colors:
  primary: "#315bd8"
  primary-hover: "#2449bb"
  on-primary: "#fcfdfe"
  background: "#f7f8fa"
  surface: "#fcfdfe"
  subtle: "#edf0f4"
  foreground: "#20242b"
  secondary-text: "#626b78"
  border: "#d9dde5"
  danger: "#a63138"
  danger-surface: "#fcebed"
  canvas-dot: "#cbd1dc"
  overlay: "rgb(20 27 40 / 42%)"
  primary-dark: "#8aa9ff"
  primary-hover-dark: "#a3bbff"
  on-primary-dark: "#16213b"
  background-dark: "#14171c"
  surface-dark: "#1c2128"
  subtle-dark: "#272e38"
  foreground-dark: "#e9edf3"
  secondary-text-dark: "#a7b0bc"
  border-dark: "#353d49"
  danger-dark: "#ffb2ba"
  danger-surface-dark: "#3c242c"
  canvas-dot-dark: "#343d4a"
  overlay-dark: "rgb(5 9 16 / 70%)"
typography:
  display:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "clamp(2.5rem, 4.5vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
  body:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.75rem"
  label:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
rounded:
  control: "8px"
  card: "12px"
  dialog: "16px"
spacing:
  tool-gap: "4px"
  field-gap: "6px"
  compact: "8px"
  control-x: "16px"
  panel: "20px"
  dialog: "24px"
  section: "32px"
  page-wide: "40px"
  hero-gap: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.on-primary-dark}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.subtle}"
  button-ghost:
    textColor: "{colors.secondary-text}"
    rounded: "{rounded.control}"
    size: "44px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
  item-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "16px"
  section-tab-selected:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
  canvas-toolbar:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "6px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.dialog}"
    padding: "24px"
    width: "min(440px, calc(100% - 32px))"
---

# Design System: Moodboard

## Overview

**Creative North Star: "Quiet canvas"**

Moodboard gives the user's images, links, and notes room to lead. Instrument Sans, near-white or graphite surfaces, and a restrained blue accent make the surrounding tools feel clear and compact. Preserve the Moodboard name and asterisk mark.

The world combines image emphasis with contextual tools. Product screens stay dense enough for work; presentation surfaces give content more space. Feedback comes from hover, press, selection, and visible focus. Motion supports state changes and respects reduced-motion preferences.

**Key Characteristics:**
- Image-led content with quiet neutral chrome.
- One blue accent for actions, selection, and focus.
- Compact contextual controls and gently rounded surfaces.
- Semantic light and dark modes with system preference as the default.

## Colors

The palette uses cool near-whites and graphite neutrals, with blue reserved for meaningful interaction. The frontmatter records the actual light values and their dark counterparts; CSS custom properties resolve the active theme.

### Primary

- **Canvas Blue:** Primary actions, selected item outlines, links, the asterisk mark, and focus. Its dark counterpart is a softer periwinkle blue. Primary button text uses the dedicated on-primary role rather than an assumed white.
- **Deep Canvas Blue:** Primary hover in light mode; the dark hover becomes lighter.

### Neutral

- **Near-white / Graphite Ground:** Page and editor background.
- **Clear / Graphite Surface:** Cards, fields, navigation, dialogs, and tools.
- **Cool / Slate Inset:** Secondary surfaces, selected section rows, placeholders, and skeletons.
- **Ink / Pale Ink:** Main text; **Slate / Mist Text:** supporting text.
- **Quiet Border:** Dividers and component edges. Canvas dots and modal backdrops have their own semantic roles.
- **Danger:** Error and destructive-action text with a matching danger surface. Always pair meaning with words.

**The Semantic Surface Rule.** Use the active CSS roles, never a fixed light color inside a themed component. Existing Tailwind aliases named paper, cream, ink, muted, and line map to these neutral roles; their names do not imply the former paper-and-coral palette.

## Typography

**Display and Body Font:** Instrument Sans, with sans-serif fallback. The variable Latin font is self-hosted at `/fonts/instrument-sans-latin.woff2`, covers weights 400–700, and uses font-display swap. There is no separate serif or mono face.

### Hierarchy

- **Display:** The fluid, semibold landing headline uses the display token with tight tracking and compact leading.
- **Headline:** Semibold page and landing section titles. Responsive page headings step from 1.5rem to the headline role on desktop.
- **Title:** Dialogs and empty states. Compact editor headers use a smaller semibold title to preserve tool space.
- **Body:** Regular supporting copy. Dense product descriptions use 0.875rem with 1.5rem leading; landing introduction copy uses the body role.
- **Label:** Semibold fields, actions, and item titles. Metadata uses 0.75rem. Prices and zoom readouts use tabular numbers.

**The Content First Rule.** Use sentence case, clear labels, and restrained weight changes. Keep the editor's board title truncatable with its full value available as a title; let card and viewer titles wrap.

## Layout

Use a shared 4px spacing rhythm with compact gaps and generous content boundaries. The landing and board gallery have a centered 80rem maximum width, 20px mobile gutters, and 40px desktop gutters. The client-management container is 72rem; the shared viewer is 48rem. Gallery columns progress from one to two at 640px and three at 1024px.

The public landing is a complete page: a spacious split hero, a labeled example board, example inspiration photographs, capability copy, and a quiet footer. The hero stacks below 768px. Generated example photographs use responsive 480/800/1440 image candidates; actual board previews use authorized board content.

The working editor has a 64px header, a section rail (216px, narrowing to 180px below 1024px), a scrollable freeform canvas, and a contextual inspector (320px). Desktop item placement uses a 2200px by 1800px coordinate surface with 250px cards and zoom controls. The floating add toolbar stays above the canvas. Dots are functional orientation marks at a 24px pitch and appear only on the real canvas.

Below 768px, replace canvas placement with a grid, horizontal section navigation, and inline add tools. Use one column, then two from 640px. The inspector becomes a protected-focus bottom sheet; create-item forms use the same mobile sheet treatment. Keep header controls visible while the board title truncates.

## Elevation & Depth

Cards and ordinary panels are flat, separated by tone and a single border. Floating tools, contextual menus, and dialogs receive elevation because they sit above working content. The canvas controls occupy layer 10, contextual menus layer 20, and native modal dialogs the browser's top layer.

### Shadow Vocabulary

- **Toolbar:** `0 4px 20px rgb(20 27 40 / 10%)`.
- **Context menu:** `0 8px 32px rgb(20 27 40 / 18%)`.
- **Dialog:** `0 24px 80px rgb(20 27 40 / 18%)`.

**The Working Depth Rule.** Elevate controls that float over content; leave content cards flat. Preserve native dialog backdrops and top-layer behavior.

## Shapes

Controls and fields use the control radius; cards, panels, and tool groups use the card radius; dialogs use the dialog radius. Borders are thin and quiet. Selected items add a blue border and a 2px outline with 2px offset.

Desktop inspector sheets round their exposed left edge. Mobile sheets round the two top corners and meet the bottom viewport edge. Images clip within their content cards. Avoid adding decorative page grids or dots outside the working canvas.

## Components

### Buttons

Compact, readable actions with a minimum 44px target. The shared primary and secondary buttons use 8px vertical and 16px horizontal padding, label typography, and the control radius. Primary actions use blue with the on-primary text role; secondary actions use surface, border, and inset hover. Plain icon controls use neutral text and inset hover. Disabled actions reduce opacity and show a disabled cursor.

Buttons provide a subtle 0.98 press scale. With reduced motion disabled, shared button backgrounds transition in 160ms and press transforms in 120ms, both ease-out. Keep the 3px accent focus outline with 3px offset on keyboard focus.

### Inputs / Fields

Labels remain visible above fields. Inputs use a surface fill, a quiet border, 12px horizontal padding, the control radius, and a 44px minimum height. Placeholder text uses secondary text; focused input borders use blue in addition to the global focus outline. Selects and textareas use the same theme roles; textareas resize vertically. Errors name the problem and sit beside the form.

### Cards / Containers

Shared panels and item cards use the card radius, surface fill, and border. Panels receive padding from their composition, commonly 20px. Item-card text has 16px padding. Ready images, pending images, failed previews, links, and notes share one presentation; pending and error states retain readable descriptions. The landing example reuses this presentation and is explicitly labeled.

Board gallery previews form a 4:3 image mosaic from actual board content, with titles and role metadata below. Empty previews use a neutral icon and plain text. Content images lead; decorative card shadows do not.

### Navigation

Section rows use a 44px minimum height and neutral inset selection. Mobile section rows scroll horizontally. The viewer uses understated section tabs with a blue underline on the selected tab. Theme controls cycle system → light → dark → system and describe the current and next setting in their accessible label. Persist explicit choices locally; use system color preference by default.

### Dialogs and Contextual Tools

The shared Dialog calls native showModal, restores the previously focused element when it closes, handles Escape, and dismisses on outside-backdrop clicks. Modal forms stay within the viewport and scroll internally. Desktop sheets reach full viewport height; mobile sheets cap at 90dvh. Preserve this protected focus behavior for item editing and sharing.

The canvas toolbar groups image, link, and note actions with a 4px gap and 6px group padding. Item selection exposes the inspector instead of adding persistent controls to every card. Keep keyboard movement and conflict/error feedback discoverable.

### Empty and Loading States

Use the existing outlined empty mark with a short title, explanatory copy, and a relevant action. Skeletons use the inset role and control radius; their 1.8s breathing animation runs only when reduced motion is not requested. Explain unavailable boards and revoked or changed client contexts in plain language.

## Do's and Don'ts

### Do:
- **Do** use semantic roles for every light and dark surface.
- **Do** retain Instrument Sans and the Moodboard asterisk mark.
- **Do** preserve 44px interaction targets, visible focus, and native protected-focus dialogs.
- **Do** let user content lead and label generated landing imagery as examples.
- **Do** use contextual desktop tools and the responsive mobile grid and sheets.

### Don't:
- **Don't** restore coral accents, serif headings, or decorative paper textures.
- **Don't** repeat canvas dots outside the real working canvas.
- **Don't** add scroll spectacle or ignore reduced-motion preferences.
- **Don't** hardcode light surfaces or assume primary button text is white in dark mode.
- **Don't** imply approvals, budgets, billing, public discovery, or personal sharing are implemented.
