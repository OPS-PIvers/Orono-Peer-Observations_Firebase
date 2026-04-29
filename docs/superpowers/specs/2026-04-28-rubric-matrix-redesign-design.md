# Rubric Matrix Redesign — Design Spec

**Date:** 2026-04-28
**Owner:** Paul Ivers
**Status:** Approved (brainstorming), pending implementation plan

## Context

The Firebase rebuild of the Peer Evaluator Form has reached functional parity with the GAS prototype on plumbing (auth, Firestore data, callable functions, finalize → PDF → Drive → Sheet log) but abandoned the original UX shape on its two most-used surfaces:

- **Teacher view (`/my-rubric`)** — currently a Phase-1 placeholder. The original GAS app showed teachers the full Danielson rubric as a matrix grid (one row per component, four proficiency descriptors side-by-side) with an "Assigned Areas / Full Rubric" toggle. Teachers learned to read across a row to see growth trajectory.
- **PE observation editor (`/observations/:id`)** — currently a sidebar of component IDs plus a single-component detail pane. The original GAS app used the same matrix grid as teachers, but with clickable descriptor cells (= select proficiency), checkbox look-fors, and inline per-component Tiptap notes. The PE workflow is "skim the rubric while taking live notes," and the current sidebar pattern forces tunnel vision into one component at a time.

The redesign: build **one shared matrix-grid primitive (`<RubricGrid>`)** with two modes (`view` and `edit`), and rebuild both surfaces around it. Existing Firestore data, security rules, and Cloud Functions are unchanged — this is a pure UI swap, no migrations.

Constraint reaffirmed during brainstorming: **don't blindly mirror the GAS app**. Honor the structural intent (matrix grid is non-negotiable) but keep the modern Firebase/React strengths (deep-linkable URLs, reactive Firestore listeners, autosave). No SPA-with-show/hide-divs nostalgia. PC + iPad landscape and portrait are supported viewports; phone is explicitly out of scope.

## Architecture

### The keystone primitive: `<RubricGrid>`

One component does almost all the work. Lives at `apps/web/src/components/rubric/RubricGrid.tsx`. Per domain, it renders:

- A sticky header row: `[ • | Developing | Basic | Proficient | Distinguished ]`
- One row per component, with the four descriptors laid out side-by-side as 4 columns
- Below each row, a collapsible look-fors strip
- Below the look-fors strip, a collapsible Tiptap notes strip (in `edit` mode only)

A single `mode` prop flips its personality:

```ts
type RubricGridMode =
  | {
      kind: 'view';
      assignedComponentIds: Set<string>;
      showAssignedOnly: boolean;
    }
  | {
      kind: 'edit';
      entries: ComponentEntries;
      notes: ComponentNotes;
      readOnly: boolean;
      onProficiency: (componentId: string, level: ProficiencyLevel | null) => void;
      onToggleLookFor: (componentId: string, lookForId: string) => void;
      onNotesChange: (componentId: string, doc: TiptapDoc) => void;
    };
```

- **`view`** — descriptor cells render as plain text. ✓/○ assignment indicator next to each component title. No look-fors checkbox state, no notes strip — this mode is "show the rubric structure," nothing more.
- **`edit`** — descriptor cells are clickable. The selected cell takes OPS Primary Blue background + white text; the other three on that row revert to default. Click the same cell or its small ✕ to clear. Look-fors are real checkboxes. Each row gets a Tiptap editor docked in the notes strip. When `readOnly: true`, all interactions become no-ops but the saved selections, checked look-fors, and notes content stay visible — this is the path used by teachers viewing their own finalized observation, and by anyone viewing a finalized one.

This means there is no separate "teacher observation viewer" component. A teacher viewing `/observations/:id` for one of their finalized observations hits the same `ObservationEditorPage` route as a PE, but with `readOnly: true` derived from `observation.status === 'Finalized' || observerEmail !== user.email`. One component, one set of tests, one source of truth.

### Layout A — two-pane editor on desktop, stacked on tablet portrait

The PE observation editor (`/observations/:id`) uses Layout A:

- **≥1280px:** matrix on the left (~65% width), `<ScriptEditor>` sticky on the right (~35%, full-height with its own scroll). Both panes scroll independently.
- **<1280px (iPad portrait):** `<ScriptEditor>` docks to the bottom as a fixed strip ~250px tall with its own scroll. Drag handle (or tap toggle) expands it to ~60% viewport. The matrix scrolls above.
- **All viewports:** sticky `<GlobalToolsBar>` at the top (domain nav, record-audio popover trigger, save status, finalize button).

The teacher view (`/my-rubric`) does not use Layout A — it's a single-column page (no script editor, no audio recorder, no global tools bar).

### Editing interactions

- **Selecting a proficiency** — click cell → existing `updateEntry(componentId, { proficiency })` + debounced autosave (`AUTOSAVE_DEBOUNCE_MS = 800`). Keyboard: arrow keys move within a row, `Enter`/`Space` selects.
- **Look-fors strip** — collapsible per component, default-collapsed. Once expanded, the choice persists per-component in `sessionStorage` keyed by observation ID + component ID. Inside: existing checkbox UI + existing `toggleLookFor` hook.
- **Notes strip** — collapsible per component. Auto-expands on first render if the component already has notes content (defined as: the Tiptap doc contains at least one non-empty text node, not just an empty paragraph wrapper). Inline `<TiptapEditor variant="full">` when expanded. Same `setNotesDoc` hook + same autosave.
- **Script pane** — same `<ScriptEditor>` component; component-tagging dropdown still works the same way. New behavior: clicking a tagged span scrolls the left pane to that component's row and briefly highlights it (~600ms pulse).
- **Audio recorder** — popover triggered from the GlobalToolsBar. Active recording shows a red dot indicator on the toolbar button. Transcripts arrive via the existing Firestore `onSnapshot` and surface in the script editor.
- **Save status** — single indicator in the top-right of the GlobalToolsBar. `Saving… / All changes saved / Save failed: <msg>`.
- **Read-only mode** (finalized OR not the observer) — descriptor cells get `cursor: not-allowed`; saved selection still highlighted; clicks are no-ops; look-fors and notes editor are read-only; toolbar's "Record audio" / "Finalize" buttons disabled.

No new Firestore reads or writes. The new editor produces the exact same observation document shape as the current one. Existing 233 finalized observations + any drafts render identically.

## File-by-file changes

### Dies (deleted entirely)

- The `ComponentNav`, `ComponentEditor`, and `ViewTabs` components inside `apps/web/src/observations/ObservationEditorPage.tsx`. These are the sidebar+detail bones the matrix replaces.
- `apps/web/src/routes/MyRubric.tsx` (Phase-1 placeholder) — replaced by `MyRubricPage.tsx`.

### New

- `apps/web/src/components/rubric/RubricGrid.tsx` — the keystone primitive, both modes
- `apps/web/src/components/rubric/RubricRow.tsx` — one component row (descriptors + collapsible look-fors + collapsible notes)
- `apps/web/src/components/rubric/DomainSection.tsx` — wraps a domain's rows + sticky descriptor-column header
- `apps/web/src/components/rubric/DomainNav.tsx` — sticky `Domain 1 / 2 / 3 / 4` jump bar with scroll-spy
- `apps/web/src/components/rubric/AssignmentToggle.tsx` — segmented control "Assigned only / Full Rubric"
- `apps/web/src/components/rubric/index.ts` — re-exports
- `apps/web/src/observations/GlobalToolsBar.tsx` — sticky top toolbar for the editor (domain nav + record-audio popover + finalize button + save status)
- `apps/web/src/routes/MyRubricPage.tsx` — teacher landing page (replaces placeholder)
- `apps/web/src/observations/RecentObservationsStrip.tsx` — used by `MyRubricPage`; lists up to 5 finalized observations with a "View all" link to inflate inline

### Significantly trimmed

- `apps/web/src/observations/ObservationEditorPage.tsx` — drops from 816 lines to ~200. Becomes: load observation + rubric + mapping → render `<GlobalToolsBar>` + Layout A's two-pane (matrix on left, `<ScriptEditor>` on right) → `<FinalizeDialog>`. Existing autosave debounce, draft ref, and Firestore write logic relocates without behavior change.

### Stays as-is

- `apps/web/src/observations/ObservationsListPage.tsx` (PE landing page — flat filterable table)
- `apps/web/src/observations/NewObservationPage.tsx` (creates a new draft, redirects to editor)
- `apps/web/src/observations/ScriptEditor.tsx` (already designed as embeddable; just relocates)
- `apps/web/src/observations/AudioRecorder.tsx` (same)
- `apps/web/src/observations/component-tag-mark.ts` (Tiptap mark)
- `apps/web/src/routes/RoleAwareRedirect.tsx`
- `apps/web/src/auth/*`
- All of `apps/web/src/admin/*`
- All routes in `apps/web/src/App.tsx` — no new routes, no removed routes. `/my-rubric` and `/observations/:id` get new contents; everything else is identical.

## Teacher view (`/my-rubric`)

Single-column page. Top to bottom:

1. **Header** — "My Rubric — `<role>`, Year `<n>`" + `<AssignmentToggle>` (default = Assigned, persisted in `sessionStorage`).
2. **Recent observations of me** — `<RecentObservationsStrip>` showing up to 5 finalized observations where `observedEmail == user.email`, ordered by `finalizedAt desc`. Each card: observation name (or "Standard observation"), observer name, finalized date, link to PDF in Drive, and a click-through to `/observations/:id` (which renders the editor in read-only mode for them, populated with that observation's data). Hidden entirely if zero finalized observations. "View all →" link inflates the strip into a full inline table on the same page (no new route).
3. **`<RubricGrid mode="view">`** — populated from the teacher's role+year mapping. Same domain navigation, same look-fors strips. No notes strips.

Click an observation card → `/observations/:id`. The PE editor in read-only mode IS the teacher's observation viewer. One component, one set of tests, one source of truth.

## Performance

An Orono rubric is 4 domains × ~5 components = ~20 components, each with 4 descriptors + ~5 look-fors + (in edit mode) a Tiptap editor. ~20 Tiptap instances rendered eagerly is the only concern.

**Mitigation:** lazy-mount per-component Tiptap _only when the notes strip is expanded_. Collapsible strip already gates the mount. First open is a one-time ~50ms Tiptap init; subsequent toggles only show/hide.

The descriptor matrix itself is plain text in CSS Grid — no virtualization needed at 20 rows.

## Verification

### Manual UAT

- Sign in as Paul (Administrator) → `/my-rubric` shows the Instructional Specialist rubric in view mode + recent observations strip if any.
- Sign in as a real Teacher account (dev-seeded with appropriate role) → `/my-rubric` works the same way for their role/year.
- Open one of the 233 imported finalized observations from `/observations` → matrix renders with that observation's stored proficiencies/look-fors/notes correctly populated; read-only enforced.
- Create a new draft → click cells, expand look-fors, type in notes, type in script pane, record audio. Refresh the page mid-flow. Everything autosaved.
- Finalize the new draft → same finalize flow as today (PDF + Drive + Master Log Sheet).
- iPad landscape (1024px+) — full Layout A two-pane works, matrix is comfortable.
- iPad portrait — script pane docks to bottom strip, matrix scrolls horizontally where needed, sticky component-title column on the left preserves context.

### Automated

- New Vitest + React Testing Library tests for `<RubricGrid>` covering: both modes render, cell click in `edit` triggers `onProficiency`, look-fors strip toggles + checkbox state syncs, notes strip lazy-mounts Tiptap, read-only mode disables all interactions, ✓/○ assignment indicators render correctly in `view` mode.
- Updated existing `App.test.tsx` to remove references to deleted sidebar components.
- One new Playwright smoke test in the existing E2E suite: "PE creates draft → fills two components via the matrix → script-tags a span → finalizes."

## Implementation order

Each step ships independently green; no Big-Bang switchover.

1. **`<RubricGrid>` primitive in isolation.** Pure component, no Firestore. Vitest tests with fixture data assert grid renders, cells are clickable in `edit` mode, look-fors and notes strips toggle, ✓/○ indicators show in `view` mode. No app-shell integration. The existing sidebar/detail editor stays functional during this step — nothing else changes.
2. **Replace `MyRubric` placeholder with `<MyRubricPage>`.** Uses the new grid in `view` mode + `<RecentObservationsStrip>`. Lowest-risk surface (read-only, no autosave, no rules edge cases). Validates the grid against real Firestore data + assignment toggle + scroll/sticky behavior.
3. **Rewire `ObservationEditorPage`.** Strip the sidebar/detail components, drop in `<RubricGrid mode="edit">` + Layout A's two-pane layout + `<GlobalToolsBar>`. Existing autosave/draft/finalize logic relocates without behavioral changes; verify existing 233 finalized observations + any drafts render identically.
4. **Domain nav + scroll spy.** Last because it's pure polish on top of an already-functional grid.

## Out of scope (explicitly)

- Phone (sub-tablet) viewport support. Tablet portrait is the narrowest supported viewport.
- New observation lifecycle behaviors (creation, finalization, deletion). Pure UI swap.
- Schema changes to `/observations`, `/rubrics`, `/staff`, or any other Firestore collection.
- The `/staff.role` schema concern (rubric assignment vs. app permissions) — separate, deferred.
- Admin section (`/admin/*`) — not touched.
- New observations list page filters or features — `ObservationsListPage` stays as-is.

## Open questions

None at brainstorming-spec time. Any new questions surfaced during implementation get raised here.
