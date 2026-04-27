---
version: alpha
name: OPS Technology Style — Instructional
description: The instructional half of the OPS Technology Style system — a red, white, and blue district palette paired with Lexend headings and Roboto body, tuned for materials that need to be read across a room, understood at a glance, or printed. Use for slide decks, PD presentations, newsletters, landing pages, instructional websites, parent-facing reports, and printed handouts. For dense web-app UI (forms, dashboards, admin tools), see the companion Technical style.

colors:
  # ========================================================================
  # BRAND COLORS — these are the canonical OPS Tech values.
  # Do not alter. Every other color token below is derived from these.
  # ========================================================================

  # Canonical blues (from the official OPS Tech stylesheet)
  blue-lighter: '#eaecf5' # canonical — maps to blue-100 in the ramp
  blue-light: '#4356a9' # canonical — maps to blue-600 in the ramp
  blue: '#2d3f89' # canonical — maps to blue-700 (the brand blue)
  blue-dark: '#1d2a5d' # canonical — maps to blue-900

  # Canonical reds
  red-lighter: '#e5c7c7' # canonical — maps to red-100
  red-light: '#c13435' # canonical — maps to red-600
  red: '#ad2122' # canonical — maps to red-700 (the brand red)
  red-dark: '#7a1718' # canonical — maps to red-900

  # Canonical grays
  gray-lightest: '#f3f3f3' # canonical — maps to gray-100
  gray-lighter: '#cccccc' # canonical — maps to gray-300
  gray-light: '#999999' # canonical — maps to gray-500
  gray: '#666666' # canonical — maps to gray-700
  gray-dark: '#333333' # canonical — maps to gray-900
  gray-darkest: '#1a1a1a' # canonical — maps to gray-950

  # Base neutrals
  white: '#ffffff'
  black: '#000000'

  # ========================================================================
  # TINT RAMPS — computed from canonical values for UI utility.
  # Use these for hover states, borders, disabled states, subtle backgrounds.
  # The canonical values above remain the brand-identity values.
  # ========================================================================

  # Blue ramp (11 steps)
  blue-50: '#f4f6fa' # computed — subtlest tint, barely-there surface
  blue-100: '#eaecf5' # CANONICAL (blue-lighter)
  blue-200: '#c0c7e0' # computed — disabled bg, subtle borders
  blue-300: '#97a1cb' # computed — muted text on light, 3rd-tier elements
  blue-400: '#6d7cb5' # computed — icons, muted actions
  blue-500: '#5869aa' # computed — supporting elements
  blue-600: '#4356a9' # CANONICAL (blue-light)
  blue-700: '#2d3f89' # CANONICAL (blue — the brand blue)
  blue-800: '#253473' # computed — active/pressed primary button
  blue-900: '#1d2a5d' # CANONICAL (blue-dark)
  blue-950: '#0e152f' # computed — deepest emphasis, near-black blue

  # Red ramp (11 steps)
  red-50: '#f5e3e3' # computed — subtlest pink tint
  red-100: '#e5c7c7' # CANONICAL (red-lighter)
  red-200: '#deaaaa' # computed — soft pink surface
  red-300: '#d78c8d' # computed — muted warning text
  red-400: '#d06f70' # computed — softer accent
  red-500: '#c85252' # computed — mid red
  red-600: '#c13435' # CANONICAL (red-light)
  red-700: '#ad2122' # CANONICAL (red — the brand red)
  red-800: '#941c1d' # computed — active/pressed destructive button
  red-900: '#7a1718' # CANONICAL (red-dark)
  red-950: '#3d0c0c' # computed — deepest red, near-black red

  # Gray ramp (11 steps)
  gray-50: '#fafafa' # computed — off-white, page background
  gray-100: '#f3f3f3' # CANONICAL (gray-lightest)
  gray-200: '#e0e0e0' # computed — light border, disabled surface
  gray-300: '#cccccc' # CANONICAL (gray-lighter)
  gray-400: '#b3b3b3' # computed — medium-light divider
  gray-500: '#999999' # CANONICAL (gray-light)
  gray-600: '#808080' # computed — placeholder text, muted label
  gray-700: '#666666' # CANONICAL (gray)
  gray-800: '#4d4d4d' # computed — strong secondary text
  gray-900: '#333333' # CANONICAL (gray-dark — default body text)
  gray-950: '#1a1a1a' # CANONICAL (gray-darkest)

  # ========================================================================
  # SEMANTIC ROLES — the agent-facing vocabulary.
  # Prefer these over raw ramp values when building.
  # ========================================================================

  # Brand identity
  primary: '{colors.blue-700}'
  primary-strong: '{colors.blue-900}'
  primary-muted: '{colors.blue-600}'
  primary-subtle: '{colors.blue-100}'

  secondary: '{colors.red-700}'
  secondary-strong: '{colors.red-900}'
  secondary-muted: '{colors.red-600}'
  secondary-subtle: '{colors.red-100}'

  # Surfaces
  surface: '{colors.white}'
  surface-subtle: '{colors.gray-50}'
  surface-alt: '{colors.gray-100}'
  surface-inverted: '{colors.blue-900}'
  surface-raised: '{colors.blue-700}'

  # Text on surfaces
  on-surface: '{colors.gray-900}'
  on-surface-muted: '{colors.gray-700}'
  on-surface-subtle: '{colors.gray-600}'
  on-surface-disabled: '{colors.gray-500}'
  on-surface-inverted: '{colors.white}'
  on-surface-inverted-muted: '{colors.blue-100}'

  # Borders
  border-subtle: '{colors.gray-200}'
  border: '{colors.gray-300}'
  border-strong: '{colors.gray-500}'
  border-accent: '{colors.blue-700}'
  border-focus: '{colors.blue-600}'

  # Focus ring — adopted from the Technical companion system for
  # accessibility. Applied as a 3px box-shadow on focused inputs.
  focus-ring: 'rgba(45,63,137,0.1)' # blue-700 at 10% opacity

  # States
  info: '{colors.blue-700}'
  info-bg: '{colors.blue-100}'
  warning: '{colors.red-700}'
  warning-bg: '{colors.red-100}'
  error: '{colors.red-800}'
  success: '{colors.blue-600}'

  # Interactive state pairs
  primary-hover: '{colors.blue-800}'
  primary-active: '{colors.blue-900}'
  secondary-hover: '{colors.red-800}'
  secondary-active: '{colors.red-900}'

typography:
  display:
    fontFamily: Lexend
    fontSize: 72px
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Lexend
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Lexend
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Lexend
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.2
  title-lg:
    fontFamily: Lexend
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.3
  title-md:
    fontFamily: Lexend
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
  title-sm:
    fontFamily: Lexend
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
  body-lg:
    fontFamily: Roboto
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Roboto
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Roboto
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label-lg:
    fontFamily: Roboto
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.01em
  label-md:
    fontFamily: Roboto
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Roboto
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0.03em
  overline:
    fontFamily: Roboto
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0.1em
    textTransform: uppercase
  caption:
    fontFamily: Roboto
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4

spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  3xl: 64px
  4xl: 96px
  gutter: 24px
  margin: 32px
  container-max: 1200px

rounded:
  none: 0px
  sm: 4px
  md: 8px # aligned with Technical companion (was 6px prior to 2026-04-24)
  lg: 12px
  xl: 16px
  full: 9999px

# Non-standard group — the DESIGN.md spec describes elevation in prose,
# but tokenizing it here makes implementation consistent.
shadow:
  none: 'none'
  subtle: '0 1px 2px rgba(29, 42, 93, 0.08)'
  soft: '0 2px 8px rgba(29, 42, 93, 0.10)'
  medium: '0 4px 12px rgba(29, 42, 93, 0.12)'
  strong: '0 8px 24px rgba(29, 42, 93, 0.16)'

components:
  # === Buttons ===
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.white}'
    typography: '{typography.label-lg}'
    rounded: '{rounded.md}'
    paddingX: 20px
    paddingY: 10px
  button-primary-hover:
    backgroundColor: '{colors.primary-hover}'
  button-primary-active:
    backgroundColor: '{colors.primary-active}'
  button-primary-disabled:
    backgroundColor: '{colors.gray-300}'
    textColor: '{colors.gray-600}'

  button-secondary:
    backgroundColor: '{colors.gray-700}'
    textColor: '{colors.white}'
    typography: '{typography.label-lg}'
    rounded: '{rounded.md}'
    paddingX: 20px
    paddingY: 10px
  button-secondary-hover:
    backgroundColor: '{colors.gray-800}'

  button-outlined:
    backgroundColor: '{colors.white}'
    textColor: '{colors.primary}'
    borderColor: '{colors.primary}'
    borderWidth: 1.5px
    typography: '{typography.label-lg}'
    rounded: '{rounded.md}'
    paddingX: 20px
    paddingY: 10px
  button-outlined-hover:
    backgroundColor: '{colors.blue-50}'

  button-inverted:
    backgroundColor: '{colors.white}'
    textColor: '{colors.blue-900}'
    typography: '{typography.label-lg}'
    rounded: '{rounded.md}'
    paddingX: 20px
    paddingY: 10px

  button-destructive:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.white}'
    typography: '{typography.label-lg}'
    rounded: '{rounded.md}'
    paddingX: 20px
    paddingY: 10px
  button-destructive-hover:
    backgroundColor: '{colors.secondary-hover}'

  # Commit action — use for form submissions on web-based instructional
  # materials (sign-up forms, RSVPs, contact forms). Red signals finality,
  # not destruction. Distinct from button-destructive only in semantics;
  # visually they share the same red treatment.
  button-submit:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.white}'
    typography: '{typography.label-lg}'
    rounded: '{rounded.md}'
    paddingX: 20px
    paddingY: 10px
  button-submit-hover:
    backgroundColor: '{colors.secondary-hover}'

  button-ghost:
    backgroundColor: transparent
    textColor: '{colors.primary}'
    typography: '{typography.label-lg}'
    rounded: '{rounded.md}'
    paddingX: 12px
    paddingY: 8px
  button-ghost-hover:
    backgroundColor: '{colors.blue-50}'

  # === Inputs ===
  input:
    backgroundColor: '{colors.white}'
    textColor: '{colors.on-surface}'
    borderColor: '{colors.border}'
    borderWidth: 1.5px
    typography: '{typography.body-md}'
    rounded: '{rounded.md}'
    paddingX: 12px
    paddingY: 10px
  input-hover:
    borderColor: '{colors.border-strong}'
  input-focus:
    borderColor: '{colors.border-focus}'
    boxShadow: '0 0 0 3px {colors.focus-ring}' # accessibility ring
  input-error:
    borderColor: '{colors.secondary}'
  input-disabled:
    backgroundColor: '{colors.gray-100}'
    textColor: '{colors.on-surface-disabled}'
  input-label:
    typography: '{typography.label-md}'
    textColor: '{colors.on-surface}'
  input-helper:
    typography: '{typography.caption}'
    textColor: '{colors.on-surface-subtle}'
  input-error-message:
    typography: '{typography.caption}'
    textColor: '{colors.red-600}'

  # === Callouts ===
  callout-info:
    backgroundColor: '{colors.info-bg}'
    textColor: '{colors.on-surface}'
    borderLeftColor: '{colors.info}'
    borderLeftWidth: 3px
    rounded: '{rounded.md}'
    padding: 20px
  callout-warning:
    backgroundColor: '{colors.warning-bg}'
    textColor: '{colors.red-900}'
    borderLeftColor: '{colors.warning}'
    borderLeftWidth: 3px
    rounded: '{rounded.md}'
    padding: 20px
  callout-neutral:
    backgroundColor: '{colors.gray-100}'
    textColor: '{colors.on-surface}'
    borderLeftColor: '{colors.gray-700}'
    borderLeftWidth: 3px
    rounded: '{rounded.md}'
    padding: 20px

  # === Cards ===
  card:
    backgroundColor: '{colors.surface}'
    borderColor: '{colors.border-subtle}'
    borderWidth: 1px
    rounded: '{rounded.lg}'
    padding: 24px
    shadow: '{shadow.subtle}'
  card-raised:
    backgroundColor: '{colors.surface-raised}'
    textColor: '{colors.white}'
    rounded: '{rounded.lg}'
    padding: 24px
    shadow: '{shadow.soft}'
  card-subtle:
    backgroundColor: '{colors.surface-alt}'
    rounded: '{rounded.lg}'
    padding: 24px

  # === Tables ===
  table-header:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.white}'
    typography: '{typography.label-lg}'
    paddingX: 16px
    paddingY: 12px
  table-row:
    backgroundColor: '{colors.white}'
    textColor: '{colors.on-surface}'
    typography: '{typography.body-md}'
    borderBottomColor: '{colors.border-subtle}'
    paddingX: 16px
    paddingY: 12px
  table-row-alt:
    backgroundColor: '{colors.surface-alt}'
  table-row-action-required:
    backgroundColor: '{colors.red-100}'
    textColor: '{colors.red-900}'

  # === Navigation ===
  nav-bar:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.white}'
    typography: '{typography.label-lg}'
    paddingX: 24px
    paddingY: 16px
  nav-link:
    textColor: '{colors.white}'
    typography: '{typography.label-lg}'
  nav-link-active:
    textColor: '{colors.blue-100}'
    borderBottomColor: '{colors.secondary}'
    borderBottomWidth: 2px

  # === Badge / chip ===
  badge:
    backgroundColor: '{colors.blue-100}'
    textColor: '{colors.blue-900}'
    typography: '{typography.label-sm}'
    rounded: '{rounded.full}'
    paddingX: 10px
    paddingY: 4px
  badge-accent:
    backgroundColor: '{colors.red-100}'
    textColor: '{colors.red-900}'
  badge-neutral:
    backgroundColor: '{colors.gray-200}'
    textColor: '{colors.gray-900}'

  # === Charts ===
  chart-series-1:
    color: '{colors.blue-700}'
  chart-series-2:
    color: '{colors.red-700}'
  chart-series-3:
    color: '{colors.blue-600}'
  chart-series-4:
    color: '{colors.red-600}'
  chart-series-5:
    color: '{colors.blue-400}'
  chart-series-6:
    color: '{colors.red-400}'
  chart-gradient-start:
    color: '{colors.blue-100}'
  chart-gradient-end:
    color: '{colors.blue-900}'
  chart-axis:
    color: '{colors.gray-700}'
  chart-grid:
    color: '{colors.gray-200}'
---

# OPS Technology Style — Instructional

## Overview

Orono Technology's visual identity is built on the district's red, white, and blue tradition — grounded in civic trust, softened by warm neutrals and human typography. The system should feel **confident, trustworthy, and legible** across every medium: a parent reading a report on their phone, a teacher glancing at a PD slide from the back of the room, a student tapping through a web tool.

This is the **instructional** half of the OPS Technology Style system. Use this file for materials that need to be read across a room, understood at a glance, or printed: slide decks, PD presentations, newsletters, landing pages, instructional websites, parent-facing reports, and printed handouts. The type scale is generous, the neutrals are warm true-gray, the shadow language is restrained, and the cards rest on borders rather than floating on shadows.

The personality lands between _institutional_ and _human_. Not corporate, not cold — but not playful or whimsical either. Lexend's slightly wide letterforms do the warming work; the brand blue does the trust work; the brand red does the emphasis work, sparingly.

Two modes:

- **Official / district-facing** (PD presentations, staff communications, parent-facing reports, dashboards, policy documents, newsletters): the full palette and typography system applies. Blue dominates, red accents, Lexend + Roboto strictly.
- **Playful / student-facing** (classroom games, fun interactives, holiday pieces): agents may choose a topic-appropriate palette while keeping Orono colors present as accents and preserving the logo lockups. The tokens in this file define the _official_ mode; playful mode is a deliberate departure.

## The companion Technical system

A sibling spec — **OPS Technology Style — Technical** — exists for dense web-application UI (workflow tools, admin dashboards, form-heavy interfaces). Both systems live under the same OPS Technology Style umbrella and share every canonical brand color, but diverge on typography, neutrals, and shadow philosophy because their use cases demand different optical tuning.

Route decisions by medium:

- **This file (Instructional):** slides, docs, newsletters, landing pages, instructional websites, printed materials. Anything where a reader is sitting still and consuming content.
- **Companion file (Technical):** workflow apps, admin dashboards, forms, data entry, submission review. Anything where a user is completing a task.

When an agent is uncertain which system applies, the question to ask is: _is this material being read, or is it being operated?_ Read → Instructional. Operated → Technical.

Shared across both systems: the canonical blue ramp (`blue-lighter`, `blue-light`, `blue`, `blue-dark`), the canonical brand red (`#ad2122`), the semantic-role vocabulary (`primary`, `surface`, `on-surface`, `border-focus`), the 12px card radius, the `focus-ring` accessibility pattern, and `button-submit` as a red commit action. Different between systems: type families (Lexend + Roboto here, Inter there), neutrals (true gray here, Tailwind slate there), canvas treatment (light surfaces or solid dark slides here, navy-gradient-with-white-cards there), and shadow philosophy (restrained + border-anchored here, two-layer shadow + borderless there).

## How this file is organized

Two parts:

1. **Canonical brand colors** — the 14 hex values defined by the OPS Tech stylesheet (4 blues, 4 reds, 6 grays). These are the brand. Never alter them.
2. **Computed tint ramps** — 11-step ramps (50 → 950) per color family, derived from the canonical values. These exist to make modern UI work fluent: hover states, disabled states, subtle borders, muted text, surface layers. Every canonical value appears in its ramp at a specific position (e.g., `blue-100` has the same hex as `blue-lighter`).

Agents should **prefer the semantic role tokens** (`primary`, `surface`, `on-surface`, `border`, `info`, etc.) when building — they express intent and adapt cleanly to both modes. Use raw ramp tokens (`blue-300`, `gray-600`) only when a semantic role doesn't fit.

## Colors

The palette is anchored by canonical brand values — deepened and lightened within each family for UI utility. **No new hues are introduced.** The only additions are mathematical tints and shades derived from the official hex values.

- **Blue (primary)** — the trust voice. Brand blue is `#2d3f89` at `blue-700`. Goes darker toward `blue-900` (`#1d2a5d`) for headlines and full-bleed backgrounds, and lighter toward `blue-100` (`#eaecf5`) for subtle surfaces. The ramp fills in the middle for hover states, disabled states, muted icons, borders, and so on.
- **Red (secondary)** — the emphasis voice. Brand red is `#ad2122` at `red-700`. Never dominant — used for accents, warnings, commit actions, and one key emphasis per view.
- **Gray (neutral)** — the working voice. An 11-step ramp from near-white (`#fafafa`) to near-black (`#1a1a1a`). Body text defaults to `gray-900` (`#333333`), not pure black.
- **White** — the resting surface. Primary canvas for documents, cards, and light-mode interfaces.

### How to think about the ramp positions

- **50** — barely-there tint. Page backgrounds that still feel white.
- **100** — subtle tint. Callout backgrounds, disabled surfaces, tag backgrounds. (Canonical `-lighter` values live here.)
- **200–400** — light-to-medium. Borders, dividers, muted icons, disabled text.
- **500** — true midtone. (Canonical `gray-light` lives here.)
- **600** — deep supporting. Icon colors on light surfaces, secondary hover states. (Canonical `blue-light` and `red-light` live here.)
- **700** — the **brand values**. Primary actions, nav bars, headings. (Canonical `blue`, `red`, and `gray` live here.)
- **800** — pressed/active state for brand-colored interactive elements.
- **900** — deepest brand color. Full-bleed title backgrounds, high-contrast headings. (Canonical `-dark` values live here.)
- **950** — near-black deepest shade. Rarely needed; use for maximum contrast moments.

### Dominance

Official pieces should land near **60% blue, 15% red, 25% neutral**. If red is reading as a co-lead, pull it back to accent-only.

### Chart sequencing

Multi-series charts order as: `blue-700` → `red-700` → `blue-600` → `red-600` → `blue-400` → `red-400`. Sequential gradients run `blue-100` → `blue-900`. Do not introduce off-palette hues unless the data semantically requires categorical meaning the brand palette cannot express.

## Typography

Two families do all the work:

- **Lexend** — all headings, all titles, all button and nav labels. Lexend's slightly wide, readability-focused construction keeps the voice confident without tipping into corporate. Weights used: 600 for titles, 700 for display and headlines.
- **Roboto** — all body copy, all captions, all helper text, all table cells, all labels. Weights: 400 regular, 500 for labels.

**Fallbacks** (PowerPoint without Lexend installed, offline contexts): Calibri, then Arial. Never Times New Roman. Never Comic Sans. Never a decorative display font for body.

The typography scale spans 72px display down to 11px overline, across 15 levels. Headings (`display`, `headline-*`) use tight line-height (1.05–1.2) and slight negative letter-spacing for density. Body (`body-*`) runs at 1.5–1.6 line-height for long-form readability. Labels (`label-*`) use positive letter-spacing for the slight small-caps effect common in UI chrome. The `overline` token is for uppercase section markers.

**This type system does not cross over to the Technical system.** If you're working on a workflow app or admin UI, use Inter (via the Technical sibling). Mixing Lexend into a PaperPal-style form will make fields feel disproportionately loud; mixing Inter into a slide deck will make headings feel underweight from the back of a classroom. The two families serve distinct optical problems.

### On adding a third font family

Some modern design systems use a distinct font for UI labels and metadata — typically a geometric sans like Space Grotesk or a monospace like JetBrains Mono — to create a clear visual boundary between _content_ and _UI chrome_. OPS Tech uses Roboto for both, which is the more common approach and works well.

If OPS ever wanted to explore this, candidates that pair well with Lexend include **Space Grotesk** (geometric, slightly quirky), **IBM Plex Mono** (legible, serious), or **Lexend Deca** (same family, tighter letterforms). This would be a brand decision — not something agents should introduce on their own.

## Layout

A **fluid grid** on small screens, **fixed max-width (1200px)** on desktop. Content breathes inside a consistent 8px spacing rhythm — micro-adjustments use `xs` (4px), related groups use `sm` (8px) or `md` (16px), section separation uses `lg` (24px) or `xl` (32px), major page regions use `2xl` (48px) or `3xl` (64px).

Card internal padding defaults to 24px. Form inputs use 10px vertical / 12px horizontal padding. Buttons use 10px / 20px. These consistent rhythms are what make the composition read as a system rather than a collection.

## Elevation & Depth

The system is **functionally flat** — hierarchy is conveyed through color contrast and thin borders rather than heavy shadows. Cards sit on surfaces via a 1px `border-subtle` at `gray-200`, often with a `shadow.subtle` for the slightest lift. Higher elevation levels (`shadow.soft`, `shadow.medium`, `shadow.strong`) exist but should be used sparingly — the system reads as "paper on paper," not floating UI.

In dark-mode contexts (`blue-900` backgrounds), hierarchy comes from **tonal layering**: content sits on a `blue-700` surface, which sits on a `blue-900` canvas. A thin `blue-600` border or red left-accent line defines edges.

## Shapes

**Moderately rounded.** The default corner radius is `md: 8px` for buttons, inputs, badges, and small components. Cards and larger containers use `lg: 12px`. Pills and circular controls use `full`. Sharp 0px corners are avoided — the system reads as approachable, not rigid.

Never mix radius scales within a single component cluster. A card with 12px corners should not contain buttons with 16px corners.

## Components

Component tokens cover the most common atoms: buttons (7 variants with hover/active/disabled states), inputs (with hover/focus/error/disabled states, labels, helper text, and error messages), callouts (info/warning/neutral), cards (default, raised, subtle), tables (header, row, alt row, action-required row), nav (bar, link, active link), badges (default, accent, neutral), and chart series colors (6 series plus gradient and axis colors).

**Button hierarchy:**

- **Primary** — one per screen, for the most important action.
- **Secondary** — supporting actions. Gray, not red (red is for destructive and commit).
- **Outlined** — alternative actions where visual weight should stay lighter than Primary.
- **Inverted** — used on dark backgrounds.
- **Destructive** — deletion, withdrawal, consequence. Never for routine actions.
- **Submit** — commit action for form submissions (sign-ups, RSVPs, contact forms). Red signals finality rather than destruction. Visually identical to `button-destructive`; the distinction is semantic.
- **Ghost** — tertiary actions, toolbar buttons.

**Input states** always preserve the 1.5px border width; only the color changes across default/hover/focus/error states. On focus, a 3px `focus-ring` box-shadow is added for accessibility — keyboard users and low-vision users depend on this. Helper text sits below the input in `caption` typography; error messages replace helper text in `red-600`.

**Callouts** use a subtle tinted background with a 3px colored left border. Info uses blue tones, warning uses red tones, neutral uses gray. The left-border pattern is intentional — it scans as "aside" more reliably than a full bordered box.

**Tables** put a brand blue header row with white text on top of alternating white / `gray-100` body rows. Rows flagged as "action required" use `red-100` backgrounds with `red-900` text.

## Do's and Don'ts

- **Do** use the semantic role tokens (`primary`, `surface`, `on-surface`, `border`) over raw ramp values. They express intent and adapt cleanly.
- **Do** use brand blue as the dominant color in official pieces — roughly 60% of the color weight.
- **Do** use brand red as accents and for a single key emphasis per view, not as a co-lead.
- **Do** use `gray-900` (`#333333`) for body text on light backgrounds, not pure black.
- **Do** use white text on `blue-900` backgrounds, with `blue-100` for muted secondary text.
- **Do** pair Lexend (headings) with Roboto (body, labels) — only these two families.
- **Do** keep all callouts, cards, and inputs on the 8px / 12px radius scale consistently within a piece.
- **Do** order chart series blue-700 → red-700 → blue-600 → red-600 → blue-400 → red-400.
- **Do** route to the Technical companion system for workflow apps, admin dashboards, and form-heavy interfaces. Don't force this file's type scale into a dense admin UI.

- **Don't** invent new hues for UI needs — everything you need is in the computed ramps.
- **Don't** use more than two font families. Lexend + Roboto, full stop.
- **Don't** use brand red as a primary surface color or let it equal brand blue in visual weight.
- **Don't** use pure black (`#000000`) for body text.
- **Don't** use Times New Roman, Comic Sans, or decorative display fonts anywhere.
- **Don't** place the Primary Logo directly on `blue-900` — the blue wordmark disappears. Use the Torch Icon, Secondary Logo, or a white plate.
- **Don't** center body text — left-align. Center headlines and titles only.
- **Don't** mix radius scales inside a single component cluster.
- **Don't** use heavy drop shadows. Hierarchy comes from color and thin borders; `shadow.subtle` is the default lift.
- **Don't** import Inter, Tailwind slate, or the two-layer card shadow from the Technical system — those belong to a different optical problem.
