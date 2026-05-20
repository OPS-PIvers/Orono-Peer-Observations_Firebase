# Admin Console UI Modernization — Design

**Date:** 2026-05-20
**Status:** Approved (design); pending implementation plan

## Goal

Make the admin console feel modern, professional, and intuitive — "clean &
airy" — by upgrading the shared design foundation and primitives rather than
redesigning pages one at a time. Every admin page should level up at once and
stay visually consistent.

## Constraints & guarantees

- **Presentational only.** No changes to behavior, data, Firestore reads/writes,
  routing, or business logic. This is styling + composition.
- **Responsive preserved.** `AdminDataView` keeps its desktop-table /
  mobile-card split; all changes work in both.
- **Brand intact.** OPS identity (Lexend/Roboto, blue/red palette, logo) stays;
  it simply moves more to the global nav + accents instead of heavy per-page
  dark bands.
- **Phased rollout.** Foundation + shared primitives first; then a per-page
  verification sweep. No big-bang rewrite of individual pages.

## Current state (context)

- Tailwind v4 with `@theme` tokens in `apps/web/src/index.css` — full OPS
  palette, semantic tokens (background/primary/accent/border/ring), `--radius:
0.375rem`, Lexend/Roboto.
- shadcn-style primitives in `apps/web/src/components/ui/` (button, input,
  dialog, dropdown-menu, checkbox, label, table, textarea, sheet, tiptap).
- Shared admin building blocks: `PageHeader` (dark-blue sticky strip, default),
  `AdminDataView` (responsive table/cards with selection + sorting).
- The dated feel comes from composition, not missing infra: heavy dark-blue
  page headers, dense/plain tables, flat spacing, inconsistent buttons/forms,
  weak empty/loading states, and limited wayfinding.

## Design

Five parts. All five are foundation/shared-primitive changes; individual pages
mostly inherit the improvements.

### 1. Foundation tokens (`index.css`)

- **Radius:** bump `--radius` from `0.375rem` to `0.5rem` for softer surfaces.
- **Borders:** introduce a softer default border (~`#e5e7eb`) so cards/tables
  read as airy, not boxy. Keep `--ops-gray-lighter` available where stronger
  rules are wanted.
- **Shadows:** add two subtle shadow tokens — `--shadow-card` (resting) and
  `--shadow-popover` (overlays) — used by cards, dialogs, dropdowns.
- **Spacing rhythm:** standardize page padding and section gaps via shared
  classes/components (page = `px-4 md:px-6 py-6`, section gap consistent).
- **Type scale:** documented hierarchy — page title (Lexend, blue-dark),
  section heading, body (Roboto), caption/muted — applied through primitives.

### 2. Page chrome (`PageHeader`)

- Make the **light** treatment the default for admin pages: white background,
  brand-blue Lexend title, optional one-line muted subtitle, right-aligned
  actions, a thin bottom hairline.
- Add an optional **breadcrumb** ("Admin › Staff") for wayfinding.
- Keep the existing dark variant available (opt-in) for any landing/top-level
  surface that wants it; the global top bar + sidebar carry the dark-blue
  brand identity.

### 3. Tables (`AdminDataView`)

- **Header row:** uppercase, muted, lighter weight, smaller; clearer sort
  affordance.
- **Rows:** comfortable height, row hover, lighter separators; action kebab
  right-aligned and quiet.
- **Empty state:** a reusable `EmptyState` (icon + message + optional primary
  action) instead of plain centered text.
- **Loading:** keep/polish skeleton rows.
- **Status chips:** a reusable `Badge` primitive (tones: neutral / active /
  inactive / info / warning) so Active/Inactive/System chips are consistent
  everywhere they appear.

### 4. Forms & dialogs

- Standardize field spacing, label + helper-text pattern, and larger touch
  targets across edit modals and settings forms.
- **Dialogs:** new radius/shadow, a **sticky footer** (Cancel left/secondary,
  primary right), consistent header/description.
- **Long forms** (e.g. Staff dialog): group into labeled sections.
- Inline validation styling (error border + message), consistent across forms.

### 5. Consistency layer (primitives)

- **Buttons:** one clear hierarchy — primary (blue), secondary (gray/outline),
  ghost, destructive (red) — applied consistently; ensure variants exist and
  pages use the right one.
- **Inputs/selects:** unified styling (border, radius, focus ring, height).
- **Card:** add a `Card` primitive for settings/branding panels and grouped
  content (surface + `--shadow-card` + radius + padding).
- **Spacing:** consistent gaps between sections, cards, and form rows.

## Components touched

- New: `Card`, `Badge`, `EmptyState`, breadcrumb (in `PageHeader` or its own).
- Upgraded: `PageHeader` (light default + breadcrumb), `AdminDataView`
  (header/rows/empty/loading), `Button`/`Input`/`Dialog` (radius/shadow/spacing
  consistency), `index.css` tokens.
- Pages: mostly inherit; targeted edits where a page passes header variant or
  uses ad-hoc chips/cards that should adopt the new primitives.

## Success criteria

- Admin pages share one consistent visual system (spacing, type, buttons,
  surfaces) with no per-page drift.
- Page headers are light/airy with clear titles + breadcrumbs; the dark-blue
  brand lives in the global nav.
- Tables, forms, dialogs, and empty/loading states look polished and modern.
- Zero behavioral/functional regressions; responsive behavior preserved.

## Out of scope

- Staff-facing dashboard redesign (separate effort).
- Any data model, routing, or feature changes.
- A new component library or framework migration.

## Rollout

1. Foundation tokens + new/upgraded primitives (`Card`, `Badge`, `EmptyState`,
   `PageHeader`, `AdminDataView`, button/input/dialog) — one PR.
2. Per-page verification sweep: confirm each admin page renders correctly with
   the new defaults; apply small targeted edits (header variant, adopt
   `Badge`/`Card`) where needed.
3. Verify in browser preview; typecheck + lint + format; push to dev-paul.
