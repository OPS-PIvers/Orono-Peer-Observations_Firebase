# Composed Dashboard Step Builder — Design

- **Date:** 2026-05-22
- **Status:** Approved (design); pending written-spec review
- **Author:** Paul Ivers (with Claude)
- **Supersedes:** the per-type checkpoint config introduced in `2026-05-19-admin-dashboard-redesign`

## Problem

The staff dashboard shows a fixed set of 8 built-in checkpoint types (signup,
pre-obs, observation, review-draft, post-obs, acknowledge, work-product,
instructional-round). Each type's logic — *when it appears*, *when it's done*,
*what date it shows*, *where its button goes* — is hardcoded in
`apps/web/src/dashboard/deriveCheckpoints.ts`. Admins can only enable/disable,
reorder, and rename them.

Two consequences:

1. **The admin language is confusing.** Because the real logic is hidden in
   code, the `/admin/dashboard` "Cycle steps" tab can only describe behavior in
   prose ("When it shows: …") that doesn't map to anything the admin controls.
2. **No new steps.** Admins can't express a step the 8 builders don't already
   cover, even though every signal they'd want (a date being set, an
   observation being created/finalized) is already recorded in Firestore.

## Goals

- Let admins **compose dashboard steps** from a vocabulary of trackable events,
  rather than relying on hidden hardcoded builders.
- **Convert the 8 built-ins into editable seed steps** — one unified model. The
  admin can tweak, reorder, delete, or add steps.
- Make the admin UI **plain-language**: every option reads as a full sentence,
  which fixes the "confusing language" problem as a side effect.
- Leave a clean **extensibility hook** so a future module-assignment subsystem
  (see companion stub) can register new events without rearchitecting.

## Non-goals

- The module-assignment / Google-Doc workflow itself. Captured separately in
  `2026-05-22-module-assignments-stub.md`; **not built here**.
- Boolean expressions (AND/OR) within a slot. Each slot watches **one** event.
  If "A and B" is ever needed we add it then (YAGNI guard).
- Changing `DashboardView` or the card visual design. The interpreter emits the
  same `CheckpointWithStatus[]` the view already consumes.

## Decisions (resolved during brainstorming)

1. **Build custom steps** (full builder), not just clearer copy.
2. **Convert built-ins to editable templates** — one unified step model.
3. Each step has **in-progress states** (progress bar) **and explicit chaining**
   (a step can wait for the previous step to finish).
4. **Meetings/visit complete when their date passes** — pre-obs done when the
   pre-obs date passes, post-obs when the post-obs date passes, the classroom
   observation when the observation date passes. Finalization drives only the
   *later* cards (review-draft, work-product, instructional-round done on
   finalize; acknowledge on sign-off).
5. **Approach A** — declarative config + event registry interpreter, **one
   event per slot**.

## Data model

New schema in `packages/shared/src/schema/dashboard.ts`.

### Slot vocabularies

```
BOOLEAN_EVENTS = [
  'observationCreated',   // a draft of the watched kind exists
  'signupWindowOpened',   // PE invited this staff member, slot unbooked
  'signupSlotBooked',     // staff chose a time in that window
  'preObsDateSet', 'preObsDatePassed',
  'observationDateSet', 'observationDatePassed',
  'postObsDateSet', 'postObsDatePassed',
  'finalized',            // status === finalized
  'acknowledged',         // acknowledgedAt set
]

ShowWhen = BOOLEAN_EVENTS ∪ { 'always', 'previousStepDone' }
DoneWhen = BOOLEAN_EVENTS ∪ { 'never' }
DateSource = { 'none','preObsDate','observationDate','postObsDate','finalizedAt','createdAt','lastModifiedAt' }
InProgressSource = { 'none', 'responseProgress' }   // responseProgress => answered / total bar
WatchedKind = { 'standard', 'workProduct', 'instructionalRound', 'any' }
ButtonTarget = { 'observation', 'booking', 'acknowledge', 'fixedUrl', 'none' }
ChipStyle = { 'form', 'meeting', 'observation', 'review' }
```

### `DashboardStep`

```ts
const dashboardStep = z.object({
  id: z.string().min(1),                 // stable; seeds reuse the built-in key
  enabled: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
  watchedKind: z.enum(WATCHED_KINDS).default('standard'),

  // labels
  chipStyle: z.enum(CHIP_STYLES).default('meeting'),
  chipLabel: z.string().trim().max(40).default(''),
  title: z.string().trim().max(160).default(''),
  description: z.string().trim().max(400).default(''),
  buttonLabel: z.string().trim().max(40).default(''),

  // logic slots (one event each)
  showWhen: z.enum(SHOW_WHEN).default('always'),
  doneWhen: z.enum(DONE_WHEN).default('never'),
  dateFrom: z.enum(DATE_SOURCES).default('none'),
  inProgress: z.enum(IN_PROGRESS_SOURCES).default('none'),
  hideWhenDone: z.boolean().default(false),

  // button
  buttonTarget: z.enum(BUTTON_TARGETS).default('observation'),
  buttonUrl: z.string().trim().max(2048).default(''), // used when buttonTarget==='fixedUrl'
});
```

`dashboardConfig` gains `steps: z.array(dashboardStep).default(DEFAULT_STEPS)`.
The legacy `checkpoints` field stays in the schema (optional) **for read-time
migration only** and is no longer written.

## Interpreter + event registry

`deriveCheckpoints` is rewritten. New signature:

```ts
deriveCheckpoints(steps: DashboardStep[], ctx: DeriveContext): CheckpointWithStatus[]
```

`DeriveContext` is unchanged (it already carries every observation, the
booking, and the question counts).

Internals:

- `resolveObservation(ctx, watchedKind)` → the observation a step tracks
  (finalized first, else draft; for `'any'`, the first match across kinds).
- `EVENT_EVALUATORS: Record<BooleanEvent, (ctx, kind) => { satisfied: boolean; date: Date | null }>`
  — the **registry**. One entry per event. A future module subsystem adds
  entries here without touching the interpreter.
- `DATE_SOURCES_FN: Record<DateSource, (obs) => Date | null>`.
- `responseProgress(ctx, kind) => { answered: number; total: number }`.

Per step, in sorted order:

1. Resolve the watched observation.
2. Evaluate `doneWhen` → `done` (+ completion date).
3. Evaluate `showWhen` → `shown`. `'always'` ⇒ true; `'previousStepDone'` ⇒ the
   previously **emitted** step's done flag.
4. If `!shown && !done` ⇒ skip. If `done && hideWhenDone` ⇒ skip.
5. Status: `done` ⇒ `done`; else if `inProgress==='responseProgress'` and
   `answered>0 && total>0` ⇒ `inprogress` (with percent); else if `shown` ⇒
   `soon`; else `upcoming`.
6. `dateLabel`/`monthLabel`/`completedLabel` from `dateFrom`.
7. `ctaUrl` from `buttonTarget`:
   - `observation` ⇒ `/observations/{id}`
   - `booking` ⇒ `/book/{windowId}?token=…` when `openBooking`, else
     `appSettings.signupLink`
   - `acknowledge` ⇒ empty + set `ackObservationId` (wires the existing
     Acknowledge mutation)
   - `fixedUrl` ⇒ `buttonUrl`
   - `none` ⇒ empty (inert)

Module-material tasks (`deriveModuleTasks`) remain a separate concern appended
by `StaffDashboardPage`, unchanged.

## Seed steps (the 8 built-ins as config)

| id | watches | showWhen | doneWhen | dateFrom | inProgress | button | hideWhenDone |
|----|---------|----------|----------|----------|------------|--------|--------------|
| signup | standard | signupWindowOpened | observationCreated | none | none | booking | no |
| preObs | standard | observationCreated | preObsDatePassed | preObsDate | none | observation | no |
| workProduct | workProduct | observationCreated | finalized | lastModifiedAt | responseProgress | fixedUrl `/my-rubric` | no |
| observation | standard | observationCreated | observationDatePassed | observationDate | none | observation | no |
| reviewDraft | any | observationCreated | finalized | lastModifiedAt | none | observation | yes |
| postObs | standard | observationCreated | postObsDatePassed | postObsDate | none | observation | no |
| acknowledge | standard | finalized | acknowledged | finalizedAt | none | acknowledge | no |
| instructionalRound | instructionalRound | observationCreated | finalized | createdAt | responseProgress | fixedUrl `/my-rubric` | no |

Chip styles/labels and descriptions carry over from the current
`BUILTIN_DEFAULTS`. This reproduces today's behavior, with the **improvement**
that meetings/visit now complete when their date passes (decision 4) rather than
on finalization.

## Migration

Read-time, in `useDashboardDraft` hydration and in `StaffDashboardPage`:

```
resolveSteps(config): DashboardStep[] =
  config.steps?.length ? config.steps
  : seedDefaults().map(seed => applyLegacyOverride(seed, config.checkpoints?.[seed.id]))
```

`applyLegacyOverride` carries over a legacy entry's `enabled`, `order`, and the
three label overrides (`typeLabelOverride→chipLabel`, `titleOverride→title`,
`ctaLabelOverride→buttonLabel`) onto the matching seed by id. The first Save
writes the new `steps[]` and the legacy field is never written again. No data
loss; no manual migration script needed (single config doc).

## Admin UI

`CycleStepsEditor.tsx` becomes the step builder (keeps `@dnd-kit` reorder):

- A reorderable list of step cards. Each card: drag handle, enable switch,
  chip + title, and an **Edit** expander.
- Expanded editor: chip style, chip/title/description/button-label inputs, and
  **plain-language dropdowns** for each slot. Examples:
  - *Show this step:* "Always" · "After the previous step is done" · "When the
    observation is created" · "When a sign-up window opens" · "When the pre-obs
    date passes" · …
  - *Mark it done:* "When the observation date passes" · "When it's finalized" ·
    "When the staff member acknowledges" · "Never (info only)" · …
  - *Show date from*, *In-progress bar*, *Button goes to* (+ URL field when
    "a fixed link"), *Watches which observation*, *Hide once done*.
- **Add step** (blank step) and **Delete step**.
- The dropdown option labels live in `copyStrings.ts` — this is where the
  confusing language gets rewritten.

## Preview

`previewSampleData.ts` currently hand-builds one fixture per type. To preview
**arbitrary** steps it must run the real interpreter. Replace
`buildSampleCheckpoints(cfg)` with `buildSampleCheckpoints(steps)` that runs
`deriveCheckpoints(steps, SAMPLE_DERIVE_CONTEXT)` against a synthesized
mid-cycle `DeriveContext` (a sample staff member with sample standard +
work-product + instructional-round observations carrying representative dates,
an open booking, and a partial answer count). `DashboardPreview` passes `steps`
instead of `checkpoints`. Preview stays read-only.

## Testing

New `apps/web/src/dashboard/deriveCheckpoints.test.ts` (none exists today):

- Each `EVENT_EVALUATORS` entry: satisfied/date for representative contexts
  (date set vs passed vs unset; draft vs finalized; per watched kind).
- Each seed step produces the expected card across "not started", "mid-cycle",
  and "finalized + acknowledged" contexts.
- `previousStepDone` chaining (gated until prior step done; respects reorder).
- `hideWhenDone` (review-draft vanishes once finalized).
- `inProgress` percent + label from `responseProgress`.
- `buttonTarget` resolution incl. booking fallback to `signupLink` and the
  acknowledge wiring.

Schema/migration tests in `packages/shared`: `dashboardStep` defaults parse;
`resolveSteps` seeds when `steps` absent and carries legacy overrides by id.

## Files to change

- `packages/shared/src/schema/dashboard.ts` — slot enums, `dashboardStep`,
  `steps[]` on config, `DEFAULT_STEPS`, `resolveSteps`/`applyLegacyOverride`.
- `apps/web/src/dashboard/deriveCheckpoints.ts` — interpreter + registry rewrite.
- `apps/web/src/dashboard/StaffDashboardPage.tsx` — call `resolveSteps(config)`.
- `apps/web/src/admin/dashboard/useDashboardDraft.ts` — draft holds `steps[]`,
  `setSteps`, migration on hydrate, write `steps` on save.
- `apps/web/src/admin/dashboard/CycleStepsEditor.tsx` — step builder rewrite.
- `apps/web/src/admin/dashboard/DashboardPreview.tsx` + `previewSampleData.ts` —
  interpreter-driven preview.
- `apps/web/src/admin/dashboard/copyStrings.ts` — plain-language rewrite.
- `apps/web/src/admin/dashboard/DashboardSettingsPage.tsx` — wire `setSteps`.
- New: `deriveCheckpoints.test.ts`, schema/migration tests.

## Extensibility hook (Project 2 connection)

The module-assignment subsystem connects at exactly one point: it registers a
new event (e.g. `assignmentSubmitted`) in `EVENT_EVALUATORS` and adds its option
label to the Show/Done dropdowns. `DeriveContext` gains the assignment state it
reads. No interpreter or schema-shape change. See companion stub.

## Risks

- **Behavior drift in seeds.** Mitigated by per-seed tests pinned to
  representative contexts.
- **Preview fidelity.** The synthesized context must exercise every slot or some
  custom steps won't render in preview; the sample context is built to cover all
  watched kinds and states.
- **Admin confusion from too many knobs.** Mitigated by sensible defaults
  (a new step defaults to Always / Never / no button) and plain-language labels.
