# Dashboard Step Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 8 hardcoded dashboard checkpoint builders with a unified, admin-composable step model: a declarative `DashboardStep[]` config interpreted at render time via an event registry.

**Architecture:** A new `DashboardStep` Zod schema in `@ops/shared` stores each step's labels + logic slots (show-when / done-when / date-from / in-progress / button / watched-kind). `apps/web/src/dashboard/dashboardEvents.ts` holds a pure event registry (`event → "is this true for this staff member?"`). `deriveCheckpoints.ts` becomes a generic interpreter that maps any step config to the existing `CheckpointWithStatus` shape, so `DashboardView` is untouched. The 8 built-ins ship as seed steps; a read-time migration carries legacy enable/order/label overrides forward.

**Tech Stack:** TypeScript, Zod, React, Vitest, @dnd-kit (existing), pnpm monorepo. Web tests: `pnpm --filter @ops/web exec vitest run <path>`. Shared tests: `pnpm --filter @ops/shared exec vitest run <path>`. After editing `packages/shared`, rebuild its dist (`pnpm --filter @ops/shared build`) before web code/tests can import new symbols.

**Reference spec:** `docs/superpowers/specs/2026-05-22-dashboard-step-builder-design.md`

---

## File Structure

**Create:**
- `apps/web/src/dashboard/dashboardEvents.ts` — pure event registry + helpers (`resolveObservation`, `EVENT_EVALUATORS`, `DATE_SOURCE_FN`, `responseProgress`, `toDate`).
- `apps/web/src/dashboard/dashboardEvents.test.ts` — event-registry unit tests.
- `apps/web/src/dashboard/deriveCheckpoints.test.ts` — interpreter unit tests.
- `packages/shared/src/schema/dashboard.test.ts` — schema + migration tests.

**Modify:**
- `packages/shared/src/schema/dashboard.ts` — slot enums, `dashboardStep`, `steps[]` on config, `DEFAULT_STEPS`, `resolveSteps`, `applyLegacyOverride`.
- `apps/web/src/dashboard/deriveCheckpoints.ts` — interpreter rewrite; relax `key` to `string`; add `hasBookedSlot` to `DeriveContext`.
- `apps/web/src/dashboard/StaffDashboardPage.tsx` — call `resolveSteps(config)`, compute `hasBookedSlot`.
- `apps/web/src/admin/dashboard/useDashboardDraft.ts` — draft holds `steps[]`, `setSteps`, migration on hydrate, write `steps` on save.
- `apps/web/src/admin/dashboard/previewSampleData.ts` — interpreter-driven sample context.
- `apps/web/src/admin/dashboard/DashboardPreview.tsx` — pass `steps` instead of `checkpoints`.
- `apps/web/src/admin/dashboard/CycleStepsEditor.tsx` — step-builder UI rewrite.
- `apps/web/src/admin/dashboard/copyStrings.ts` — plain-language option labels + blurbs.
- `apps/web/src/admin/dashboard/DashboardSettingsPage.tsx` — wire `setSteps`.

---

## Task 1: Slot vocabularies + `dashboardStep` schema

**Files:**
- Modify: `packages/shared/src/schema/dashboard.ts`
- Test: `packages/shared/src/schema/dashboard.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/schema/dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dashboardStep } from './dashboard.js';

describe('dashboardStep', () => {
  it('applies defaults for a minimal step', () => {
    const s = dashboardStep.parse({ id: 'x' });
    expect(s.enabled).toBe(true);
    expect(s.order).toBe(0);
    expect(s.watchedKind).toBe('standard');
    expect(s.chipStyle).toBe('meeting');
    expect(s.showWhen).toBe('always');
    expect(s.doneWhen).toBe('never');
    expect(s.dateFrom).toBe('none');
    expect(s.inProgress).toBe('none');
    expect(s.hideWhenDone).toBe(false);
    expect(s.buttonTarget).toBe('observation');
  });

  it('rejects an unknown showWhen event', () => {
    expect(() => dashboardStep.parse({ id: 'x', showWhen: 'not-an-event' })).toThrow();
  });

  it('requires a non-empty id', () => {
    expect(() => dashboardStep.parse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ops/shared exec vitest run src/schema/dashboard.test.ts`
Expected: FAIL — `dashboardStep` is not exported.

- [ ] **Step 3: Add the vocabularies + schema**

In `packages/shared/src/schema/dashboard.ts`, after the existing `dashboardCheckpointsConfig` block and before `dashboardConfig`, add:

```ts
// ─── Composed step model (replaces per-type checkpoint config) ───────────────

/** Boolean trackable events evaluated against the watched observation. */
export const BOOLEAN_EVENTS = [
  'observationCreated',
  'signupWindowOpened',
  'signupSlotBooked',
  'preObsDateSet',
  'preObsDatePassed',
  'observationDateSet',
  'observationDatePassed',
  'postObsDateSet',
  'postObsDatePassed',
  'finalized',
  'acknowledged',
] as const;
export type BooleanEvent = (typeof BOOLEAN_EVENTS)[number];

export const SHOW_WHEN_OPTIONS = [...BOOLEAN_EVENTS, 'always', 'previousStepDone'] as const;
export type ShowWhen = (typeof SHOW_WHEN_OPTIONS)[number];

export const DONE_WHEN_OPTIONS = [...BOOLEAN_EVENTS, 'never'] as const;
export type DoneWhen = (typeof DONE_WHEN_OPTIONS)[number];

export const DATE_SOURCES = [
  'none',
  'preObsDate',
  'observationDate',
  'postObsDate',
  'finalizedAt',
  'createdAt',
  'lastModifiedAt',
] as const;
export type DateSource = (typeof DATE_SOURCES)[number];

export const IN_PROGRESS_SOURCES = ['none', 'responseProgress'] as const;
export type InProgressSource = (typeof IN_PROGRESS_SOURCES)[number];

export const WATCHED_KINDS = ['standard', 'workProduct', 'instructionalRound', 'any'] as const;
export type WatchedKind = (typeof WATCHED_KINDS)[number];

export const STEP_BUTTON_TARGETS = [
  'observation',
  'booking',
  'acknowledge',
  'fixedUrl',
  'none',
] as const;
export type StepButtonTarget = (typeof STEP_BUTTON_TARGETS)[number];

export const STEP_CHIP_STYLES = ['form', 'meeting', 'observation', 'review'] as const;
export type StepChipStyle = (typeof STEP_CHIP_STYLES)[number];

export const dashboardStep = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
  watchedKind: z.enum(WATCHED_KINDS).default('standard'),
  chipStyle: z.enum(STEP_CHIP_STYLES).default('meeting'),
  chipLabel: z.string().trim().max(40).default(''),
  title: z.string().trim().max(160).default(''),
  description: z.string().trim().max(400).default(''),
  buttonLabel: z.string().trim().max(40).default(''),
  showWhen: z.enum(SHOW_WHEN_OPTIONS).default('always'),
  doneWhen: z.enum(DONE_WHEN_OPTIONS).default('never'),
  dateFrom: z.enum(DATE_SOURCES).default('none'),
  inProgress: z.enum(IN_PROGRESS_SOURCES).default('none'),
  hideWhenDone: z.boolean().default(false),
  buttonTarget: z.enum(STEP_BUTTON_TARGETS).default('observation'),
  buttonUrl: z.string().trim().max(2048).default(''),
});
export type DashboardStep = z.infer<typeof dashboardStep>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ops/shared exec vitest run src/schema/dashboard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schema/dashboard.ts packages/shared/src/schema/dashboard.test.ts
git commit -m "feat(shared): add composed dashboardStep schema + slot vocabularies"
```

---

## Task 2: Seed steps + migration helpers

**Files:**
- Modify: `packages/shared/src/schema/dashboard.ts`
- Test: `packages/shared/src/schema/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/schema/dashboard.test.ts`:

```ts
import { DEFAULT_STEPS, applyLegacyOverride, resolveSteps } from './dashboard.js';

describe('DEFAULT_STEPS', () => {
  it('has the 8 built-in ids in cycle order', () => {
    expect(DEFAULT_STEPS.map((s) => s.id)).toEqual([
      'signup',
      'preObs',
      'workProduct',
      'observation',
      'reviewDraft',
      'postObs',
      'acknowledge',
      'instructionalRound',
    ]);
  });

  it('marks meetings/visit done when their date passes', () => {
    const byId = Object.fromEntries(DEFAULT_STEPS.map((s) => [s.id, s]));
    expect(byId.preObs.doneWhen).toBe('preObsDatePassed');
    expect(byId.observation.doneWhen).toBe('observationDatePassed');
    expect(byId.postObs.doneWhen).toBe('postObsDatePassed');
    expect(byId.acknowledge.doneWhen).toBe('acknowledged');
    expect(byId.reviewDraft.hideWhenDone).toBe(true);
  });
});

describe('resolveSteps', () => {
  it('seeds DEFAULT_STEPS when config has no steps', () => {
    expect(resolveSteps(null).map((s) => s.id)).toEqual(DEFAULT_STEPS.map((s) => s.id));
  });

  it('returns saved steps verbatim when present', () => {
    const custom = [dashboardStep.parse({ id: 'only-one' })];
    expect(resolveSteps({ steps: custom } as never)).toEqual(custom);
  });

  it('carries legacy enable/order/label overrides onto the matching seed', () => {
    const steps = resolveSteps({
      checkpoints: { signup: { enabled: false, order: 5, titleOverride: 'Pick a slot' } },
    } as never);
    const signup = steps.find((s) => s.id === 'signup');
    expect(signup?.enabled).toBe(false);
    expect(signup?.order).toBe(5);
    expect(signup?.title).toBe('Pick a slot');
  });
});

describe('applyLegacyOverride', () => {
  it('returns the seed unchanged when no legacy entry', () => {
    const seed = dashboardStep.parse({ id: 'signup', title: 'Default' });
    expect(applyLegacyOverride(seed, undefined)).toEqual(seed);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ops/shared exec vitest run src/schema/dashboard.test.ts`
Expected: FAIL — `DEFAULT_STEPS` / `resolveSteps` not exported.

- [ ] **Step 3: Add seeds + migration**

In `packages/shared/src/schema/dashboard.ts`, immediately after the `dashboardStep` definition, add:

```ts
/** The 8 built-ins as editable seed steps. Reproduces today's behavior, with
 *  meetings/visit completing when their date passes (not on finalize). */
export const DEFAULT_STEPS: DashboardStep[] = [
  dashboardStep.parse({
    id: 'signup',
    order: 0,
    watchedKind: 'standard',
    chipStyle: 'meeting',
    chipLabel: 'Scheduling',
    title: 'Sign up for an observation window',
    description:
      'Pick a window that works for your class. Your peer evaluator confirms within 2 school days.',
    buttonLabel: 'Choose a window',
    showWhen: 'signupWindowOpened',
    doneWhen: 'observationCreated',
    dateFrom: 'none',
    buttonTarget: 'booking',
  }),
  dashboardStep.parse({
    id: 'preObs',
    order: 1,
    watchedKind: 'standard',
    chipStyle: 'meeting',
    chipLabel: 'Meeting',
    title: 'Pre-observation conversation',
    description:
      '20-minute conversation with your peer evaluator. Lesson plan, focus components, context.',
    buttonLabel: 'View meeting',
    showWhen: 'observationCreated',
    doneWhen: 'preObsDatePassed',
    dateFrom: 'preObsDate',
    buttonTarget: 'observation',
  }),
  dashboardStep.parse({
    id: 'workProduct',
    order: 2,
    watchedKind: 'workProduct',
    chipStyle: 'form',
    chipLabel: 'Evidence',
    title: 'Submit work-product responses',
    description:
      'Short prompts about your planning, family communication, and growth. Save and resume any time.',
    buttonLabel: 'Continue answering',
    showWhen: 'observationCreated',
    doneWhen: 'finalized',
    dateFrom: 'lastModifiedAt',
    inProgress: 'responseProgress',
    buttonTarget: 'fixedUrl',
    buttonUrl: '/my-rubric',
  }),
  dashboardStep.parse({
    id: 'observation',
    order: 3,
    watchedKind: 'standard',
    chipStyle: 'observation',
    chipLabel: 'Observation',
    title: 'Classroom observation',
    description: 'Your peer evaluator joins your room during the window you selected.',
    buttonLabel: 'View details',
    showWhen: 'observationCreated',
    doneWhen: 'observationDatePassed',
    dateFrom: 'observationDate',
    buttonTarget: 'observation',
  }),
  dashboardStep.parse({
    id: 'reviewDraft',
    order: 4,
    watchedKind: 'any',
    chipStyle: 'review',
    chipLabel: 'Review',
    title: 'Review the draft observation',
    description: 'Your peer evaluator is drafting your observation. You can view and comment now.',
    buttonLabel: 'Open draft',
    showWhen: 'observationCreated',
    doneWhen: 'finalized',
    dateFrom: 'lastModifiedAt',
    hideWhenDone: true,
    buttonTarget: 'observation',
  }),
  dashboardStep.parse({
    id: 'postObs',
    order: 5,
    watchedKind: 'standard',
    chipStyle: 'meeting',
    chipLabel: 'Meeting',
    title: 'Post-observation conversation',
    description: '30 minutes to talk through proficiency ratings and where to focus next.',
    buttonLabel: 'View meeting',
    showWhen: 'observationCreated',
    doneWhen: 'postObsDatePassed',
    dateFrom: 'postObsDate',
    buttonTarget: 'observation',
  }),
  dashboardStep.parse({
    id: 'acknowledge',
    order: 6,
    watchedKind: 'standard',
    chipStyle: 'review',
    chipLabel: 'Sign-off',
    title: 'Acknowledge the finalized observation',
    description: 'Acknowledging stores your sign-off on the finalized observation record.',
    buttonLabel: 'Acknowledge',
    showWhen: 'finalized',
    doneWhen: 'acknowledged',
    dateFrom: 'finalizedAt',
    buttonTarget: 'acknowledge',
  }),
  dashboardStep.parse({
    id: 'instructionalRound',
    order: 7,
    watchedKind: 'instructionalRound',
    chipStyle: 'observation',
    chipLabel: 'Round',
    title: 'Instructional Round',
    description: 'Reflective responses for this instructional round.',
    buttonLabel: 'View details',
    showWhen: 'observationCreated',
    doneWhen: 'finalized',
    dateFrom: 'createdAt',
    inProgress: 'responseProgress',
    buttonTarget: 'fixedUrl',
    buttonUrl: '/my-rubric',
  }),
];

/** Merge a legacy per-type checkpoint override onto a seed step by id. */
export function applyLegacyOverride(
  seed: DashboardStep,
  legacy: DashboardCheckpointConfig | undefined,
): DashboardStep {
  if (!legacy) return seed;
  return {
    ...seed,
    enabled: legacy.enabled,
    order: legacy.order,
    chipLabel: legacy.typeLabelOverride.trim() || seed.chipLabel,
    title: legacy.titleOverride.trim() || seed.title,
    buttonLabel: legacy.ctaLabelOverride.trim() || seed.buttonLabel,
  };
}

/** Resolve the effective step list from a (possibly legacy) config doc. */
export function resolveSteps(config: DashboardConfig | null | undefined): DashboardStep[] {
  if (config?.steps && config.steps.length > 0) return config.steps;
  const legacy = config?.checkpoints;
  return DEFAULT_STEPS.map((seed) =>
    applyLegacyOverride(seed, legacy?.[seed.id as CheckpointTypeKey]),
  );
}
```

Then add `steps` to the `dashboardConfig` object (after `checkpoints:`):

```ts
  steps: z.array(dashboardStep).default([]),
```

`resolveSteps` references `DashboardConfig`, `CheckpointTypeKey`, and `DashboardCheckpointConfig`, which are all already declared in this file. (`CheckpointTypeKey` is declared above; the functions sit after `dashboardConfig`/`DashboardConfig`. If TS complains about use-before-declaration for `DashboardConfig`, move `applyLegacyOverride`/`resolveSteps` to the end of the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ops/shared exec vitest run src/schema/dashboard.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schema/dashboard.ts packages/shared/src/schema/dashboard.test.ts
git commit -m "feat(shared): seed steps + legacy-config migration for dashboard builder"
```

---

## Task 3: Build shared dist + typecheck shared

**Files:** none (build step)

- [ ] **Step 1: Build the shared package**

Run: `pnpm --filter @ops/shared build`
Expected: exits 0; `packages/shared/dist` updated so the web app can import the new symbols.

- [ ] **Step 2: Typecheck shared**

Run: `pnpm --filter @ops/shared typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit (only if dist is tracked)**

```bash
git add -A packages/shared/dist 2>/dev/null || true
git commit -m "chore(shared): rebuild dist for dashboard step schema" || echo "nothing to commit"
```

(If `packages/shared/dist` is gitignored, this is a no-op — that's fine.)

---

## Task 4: Event registry (`dashboardEvents.ts`)

**Files:**
- Create: `apps/web/src/dashboard/dashboardEvents.ts`
- Create: `apps/web/src/dashboard/dashboardEvents.test.ts`

This task also adds `hasBookedSlot` to `DeriveContext`. Since `DeriveContext` lives in `deriveCheckpoints.ts` (modified in Task 5), define a local `DeriveContext` import here from `./deriveCheckpoints`. To avoid a circular-import problem, put the `DeriveContext` interface in `dashboardEvents.ts` and re-export it from `deriveCheckpoints.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dashboard/dashboardEvents.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Observation } from '@ops/shared';
import { EVENT_EVALUATORS, resolveObservation, type DeriveContext } from './dashboardEvents';

const NOW = new Date('2026-03-01T00:00:00Z');
const PAST = new Date('2026-02-01T00:00:00Z');
const FUTURE = new Date('2026-04-01T00:00:00Z');

function obs(partial: Partial<Observation>): Observation {
  return {
    observationId: 'obs-1',
    status: 'Draft',
    createdAt: PAST,
    lastModifiedAt: PAST,
    finalizedAt: null,
    acknowledgedAt: null,
    ...partial,
  } as unknown as Observation;
}

function ctx(partial: Partial<DeriveContext>): DeriveContext {
  return {
    finalizedStandard: [],
    standardDraft: null,
    workProductDraft: null,
    instructionalRoundDraft: null,
    finalizedWorkProduct: null,
    finalizedInstructionalRound: null,
    workProductQuestionsCount: 0,
    instructionalRoundQuestionsCount: 0,
    appSettings: null,
    openBooking: null,
    hasBookedSlot: false,
    hasWorkProduct: true,
    hasInstructionalRound: true,
    ...partial,
  };
}

describe('resolveObservation', () => {
  it('prefers finalized standard then draft', () => {
    const f = obs({ observationId: 'fin' });
    const d = obs({ observationId: 'draft' });
    expect(resolveObservation(ctx({ finalizedStandard: [f], standardDraft: d }), 'standard')?.observationId).toBe('fin');
    expect(resolveObservation(ctx({ standardDraft: d }), 'standard')?.observationId).toBe('draft');
  });
});

describe('EVENT_EVALUATORS', () => {
  it('observationCreated is satisfied when an observation exists', () => {
    expect(EVENT_EVALUATORS.observationCreated(ctx({}), null, NOW).satisfied).toBe(false);
    expect(EVENT_EVALUATORS.observationCreated(ctx({}), obs({}), NOW).satisfied).toBe(true);
  });

  it('preObsDateSet vs preObsDatePassed', () => {
    const future = obs({ preObsDate: FUTURE });
    const past = obs({ preObsDate: PAST });
    expect(EVENT_EVALUATORS.preObsDateSet(ctx({}), future, NOW).satisfied).toBe(true);
    expect(EVENT_EVALUATORS.preObsDatePassed(ctx({}), future, NOW).satisfied).toBe(false);
    expect(EVENT_EVALUATORS.preObsDatePassed(ctx({}), past, NOW).satisfied).toBe(true);
  });

  it('finalized reads status + finalizedAt date', () => {
    const r = EVENT_EVALUATORS.finalized(ctx({}), obs({ status: 'Finalized', finalizedAt: PAST }), NOW);
    expect(r.satisfied).toBe(true);
    expect(r.date).toEqual(PAST);
  });

  it('signupWindowOpened follows openBooking', () => {
    expect(EVENT_EVALUATORS.signupWindowOpened(ctx({}), null, NOW).satisfied).toBe(false);
    expect(
      EVENT_EVALUATORS.signupWindowOpened(ctx({ openBooking: { windowId: 'w', token: 't' } }), null, NOW).satisfied,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ops/web exec vitest run src/dashboard/dashboardEvents.test.ts`
Expected: FAIL — module `./dashboardEvents` not found.

- [ ] **Step 3: Implement `dashboardEvents.ts`**

Create `apps/web/src/dashboard/dashboardEvents.ts`:

```ts
import {
  OBSERVATION_STATUS,
  type AppSettings,
  type BooleanEvent,
  type DateSource,
  type Observation,
  type WatchedKind,
} from '@ops/shared';

/**
 * Pure event registry for the composed dashboard step interpreter.
 *
 * Each evaluator answers, for the staff member's resolved observation,
 * "is this event satisfied?" plus the date associated with it (if any).
 * A future module-assignment subsystem registers new entries here without
 * touching the interpreter.
 */

/** Context passed to the interpreter — every observation + scheduling signal
 *  the dashboard already loads. Lives here so the registry and interpreter
 *  share one definition (deriveCheckpoints re-exports it). */
export interface DeriveContext {
  finalizedStandard: Observation[];
  standardDraft: Observation | null;
  workProductDraft: Observation | null;
  instructionalRoundDraft: Observation | null;
  finalizedWorkProduct: Observation | null;
  finalizedInstructionalRound: Observation | null;
  workProductQuestionsCount: number;
  instructionalRoundQuestionsCount: number;
  appSettings: AppSettings | null;
  openBooking: { windowId: string; token: string } | null;
  /** True when the staff member has booked a slot in any invited window. */
  hasBookedSlot: boolean;
  hasWorkProduct: boolean;
  hasInstructionalRound: boolean;
}

export interface EventResult {
  satisfied: boolean;
  date: Date | null;
}

export function toDate(value: Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const maybe = value as unknown as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Pick the observation a step tracks: finalized first, else draft. */
export function resolveObservation(ctx: DeriveContext, kind: WatchedKind): Observation | null {
  switch (kind) {
    case 'standard':
      return ctx.finalizedStandard[0] ?? ctx.standardDraft ?? null;
    case 'workProduct':
      return ctx.finalizedWorkProduct ?? ctx.workProductDraft ?? null;
    case 'instructionalRound':
      return ctx.finalizedInstructionalRound ?? ctx.instructionalRoundDraft ?? null;
    case 'any':
      return (
        ctx.finalizedStandard[0] ??
        ctx.standardDraft ??
        ctx.workProductDraft ??
        ctx.instructionalRoundDraft ??
        ctx.finalizedWorkProduct ??
        ctx.finalizedInstructionalRound ??
        null
      );
  }
}

function dateSetResult(d: Date | null, now: Date, mustBePast: boolean): EventResult {
  if (!d) return { satisfied: false, date: null };
  return { satisfied: mustBePast ? d.getTime() < now.getTime() : true, date: d };
}

type Evaluator = (ctx: DeriveContext, obs: Observation | null, now: Date) => EventResult;

export const EVENT_EVALUATORS: Record<BooleanEvent, Evaluator> = {
  observationCreated: (_ctx, obs) => ({ satisfied: obs != null, date: obs ? toDate(obs.createdAt) : null }),
  signupWindowOpened: (ctx) => ({ satisfied: ctx.openBooking != null, date: null }),
  signupSlotBooked: (ctx) => ({ satisfied: ctx.hasBookedSlot, date: null }),
  preObsDateSet: (_ctx, obs, now) => dateSetResult(toDate(obs?.preObsDate), now, false),
  preObsDatePassed: (_ctx, obs, now) => dateSetResult(toDate(obs?.preObsDate), now, true),
  observationDateSet: (_ctx, obs, now) => dateSetResult(toDate(obs?.observationDate), now, false),
  observationDatePassed: (_ctx, obs, now) => dateSetResult(toDate(obs?.observationDate), now, true),
  postObsDateSet: (_ctx, obs, now) => dateSetResult(toDate(obs?.postObsDate), now, false),
  postObsDatePassed: (_ctx, obs, now) => dateSetResult(toDate(obs?.postObsDate), now, true),
  finalized: (_ctx, obs) => ({
    satisfied: obs?.status === OBSERVATION_STATUS.finalized,
    date: obs ? toDate(obs.finalizedAt) : null,
  }),
  acknowledged: (_ctx, obs) => {
    const d = toDate(obs?.acknowledgedAt);
    return { satisfied: d != null, date: d };
  },
};

export const DATE_SOURCE_FN: Record<DateSource, (obs: Observation | null) => Date | null> = {
  none: () => null,
  preObsDate: (obs) => toDate(obs?.preObsDate),
  observationDate: (obs) => toDate(obs?.observationDate),
  postObsDate: (obs) => toDate(obs?.postObsDate),
  finalizedAt: (obs) => toDate(obs?.finalizedAt),
  createdAt: (obs) => toDate(obs?.createdAt),
  lastModifiedAt: (obs) => toDate(obs?.lastModifiedAt),
};

/** answered / total for the in-progress bar, keyed by the watched kind. */
export function responseProgress(
  ctx: DeriveContext,
  obs: Observation | null,
  kind: WatchedKind,
): { answered: number; total: number } {
  const answered = obs?.workProductAnswers?.filter((a) => a.answer.trim() !== '').length ?? 0;
  const total =
    kind === 'instructionalRound'
      ? ctx.instructionalRoundQuestionsCount
      : ctx.workProductQuestionsCount;
  return { answered, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ops/web exec vitest run src/dashboard/dashboardEvents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/dashboardEvents.ts apps/web/src/dashboard/dashboardEvents.test.ts
git commit -m "feat(dashboard): pure event registry for composed steps"
```

---

## Task 5: Interpreter rewrite (`deriveCheckpoints.ts`)

**Files:**
- Modify: `apps/web/src/dashboard/deriveCheckpoints.ts`
- Create: `apps/web/src/dashboard/deriveCheckpoints.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dashboard/deriveCheckpoints.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_STEPS, dashboardStep, type Observation } from '@ops/shared';
import { deriveCheckpoints } from './deriveCheckpoints';
import type { DeriveContext } from './dashboardEvents';

const NOW = new Date('2026-03-01T00:00:00Z');
const PAST = new Date('2026-02-01T00:00:00Z');
const FUTURE = new Date('2026-04-01T00:00:00Z');

function obs(partial: Partial<Observation>): Observation {
  return {
    observationId: 'obs-1',
    status: 'Draft',
    createdAt: PAST,
    lastModifiedAt: PAST,
    finalizedAt: null,
    acknowledgedAt: null,
    ...partial,
  } as unknown as Observation;
}

function ctx(partial: Partial<DeriveContext>): DeriveContext {
  return {
    finalizedStandard: [],
    standardDraft: null,
    workProductDraft: null,
    instructionalRoundDraft: null,
    finalizedWorkProduct: null,
    finalizedInstructionalRound: null,
    workProductQuestionsCount: 0,
    instructionalRoundQuestionsCount: 0,
    appSettings: null,
    openBooking: null,
    hasBookedSlot: false,
    hasWorkProduct: true,
    hasInstructionalRound: true,
    ...partial,
  };
}

describe('deriveCheckpoints (seed behavior)', () => {
  it('hides everything for a staff member with no observation and no window', () => {
    expect(deriveCheckpoints(DEFAULT_STEPS, ctx({}), NOW)).toEqual([]);
  });

  it('shows signup as soon when a window is open', () => {
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ openBooking: { windowId: 'w', token: 't' } }),
      NOW,
    );
    const signup = cards.find((c) => c.id === 'signup');
    expect(signup?.status).toBe('soon');
    expect(signup?.ctaUrl).toBe('/book/w?token=t');
  });

  it('marks the pre-obs meeting done once its date is in the past', () => {
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ standardDraft: obs({ preObsDate: PAST, observationDate: FUTURE }) }),
      NOW,
    );
    expect(cards.find((c) => c.id === 'preObs')?.status).toBe('done');
    expect(cards.find((c) => c.id === 'observation')?.status).toBe('soon');
  });

  it('reviewDraft vanishes once finalized (hideWhenDone)', () => {
    const finalized = obs({ status: 'Finalized', finalizedAt: PAST });
    const cards = deriveCheckpoints(DEFAULT_STEPS, ctx({ finalizedStandard: [finalized] }), NOW);
    expect(cards.find((c) => c.id === 'reviewDraft')).toBeUndefined();
  });

  it('drives the work-product progress bar from answers', () => {
    const wp = obs({
      observationId: 'wp',
      workProductAnswers: [
        { answer: 'a' },
        { answer: '' },
        { answer: 'b' },
      ] as unknown as Observation['workProductAnswers'],
    });
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ workProductDraft: wp, workProductQuestionsCount: 4 }),
      NOW,
    );
    const card = cards.find((c) => c.id === 'workProduct');
    expect(card?.status).toBe('inprogress');
    expect(card?.percent).toBe(50);
    expect(card?.percentLabel).toBe('2 of 4 answered');
  });
});

describe('deriveCheckpoints (generic slots)', () => {
  it('previousStepDone gates a step until the prior one is done', () => {
    const a = dashboardStep.parse({ id: 'a', order: 0, showWhen: 'always', doneWhen: 'finalized' });
    const b = dashboardStep.parse({ id: 'b', order: 1, showWhen: 'previousStepDone', doneWhen: 'never' });
    expect(deriveCheckpoints([a, b], ctx({ standardDraft: obs({}) }), NOW).map((c) => c.id)).toEqual(['a']);
    const fin = ctx({ finalizedStandard: [obs({ status: 'Finalized', finalizedAt: PAST })] });
    expect(deriveCheckpoints([a, b], fin, NOW).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('respects enabled + order', () => {
    const a = dashboardStep.parse({ id: 'a', order: 2, showWhen: 'always' });
    const b = dashboardStep.parse({ id: 'b', order: 1, showWhen: 'always' });
    const c = dashboardStep.parse({ id: 'c', order: 0, showWhen: 'always', enabled: false });
    expect(deriveCheckpoints([a, b, c], ctx({}), NOW).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('fixedUrl button uses buttonUrl; none renders inert', () => {
    const link = dashboardStep.parse({ id: 'l', showWhen: 'always', buttonTarget: 'fixedUrl', buttonUrl: '/x' });
    const inert = dashboardStep.parse({ id: 'i', showWhen: 'always', buttonTarget: 'none' });
    const cards = deriveCheckpoints([link, inert], ctx({}), NOW);
    expect(cards.find((c) => c.id === 'l')?.ctaUrl).toBe('/x');
    expect(cards.find((c) => c.id === 'i')?.ctaUrl).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ops/web exec vitest run src/dashboard/deriveCheckpoints.test.ts`
Expected: FAIL — `deriveCheckpoints` still has the old `(cfg, ctx)` signature / type errors.

- [ ] **Step 3: Rewrite `deriveCheckpoints.ts`**

Replace the entire contents of `apps/web/src/dashboard/deriveCheckpoints.ts` with:

```ts
import {
  type DashboardStep,
  type DoneWhen,
  type Observation,
  type ShowWhen,
} from '@ops/shared';
import {
  DATE_SOURCE_FN,
  EVENT_EVALUATORS,
  resolveObservation,
  responseProgress,
  type DeriveContext,
} from './dashboardEvents';

/**
 * Dashboard checkpoint derivation.
 *
 * Generic interpreter: takes the admin's composed step configs plus the staff
 * member's real Firestore state and produces the ordered list of cards the
 * dashboard shows. Per-step logic is data (show/done/date/in-progress/button
 * slots), evaluated via the event registry in `dashboardEvents.ts`. No data is
 * fabricated — every date and status comes from an existing artifact.
 */

export type { DeriveContext } from './dashboardEvents';

export type CheckpointStatus = 'done' | 'inprogress' | 'soon' | 'upcoming';

export interface CheckpointWithStatus {
  /** Stable id used as React key and for the timeline (step id, or 'module'). */
  id: string;
  /** Originating step id, or 'module' for a module-material task. */
  key: string;
  type: 'form' | 'meeting' | 'observation' | 'review';
  typeLabel: string;
  title: string;
  desc: string;
  monthLabel: string;
  dateLabel: string;
  dueRelative: string;
  cta: string;
  ctaUrl: string;
  status: CheckpointStatus;
  completedLabel: string | null;
  percent: number | null;
  percentLabel: string;
  ackObservationId?: string;
  moduleItemId?: string;
  moduleId?: string;
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short' });
}

function evalShow(
  showWhen: ShowWhen,
  ctx: DeriveContext,
  obs: Observation | null,
  now: Date,
  prevDone: boolean,
): boolean {
  if (showWhen === 'always') return true;
  if (showWhen === 'previousStepDone') return prevDone;
  return EVENT_EVALUATORS[showWhen](ctx, obs, now).satisfied;
}

function evalDone(
  doneWhen: DoneWhen,
  ctx: DeriveContext,
  obs: Observation | null,
  now: Date,
): boolean {
  if (doneWhen === 'never') return false;
  return EVENT_EVALUATORS[doneWhen](ctx, obs, now).satisfied;
}

function resolveButton(
  step: DashboardStep,
  ctx: DeriveContext,
  obs: Observation | null,
): { ctaUrl: string; ackObservationId?: string } {
  switch (step.buttonTarget) {
    case 'observation':
      return { ctaUrl: obs ? `/observations/${obs.observationId}` : '' };
    case 'booking': {
      const booking = ctx.openBooking
        ? `/book/${ctx.openBooking.windowId}?token=${ctx.openBooking.token}`
        : '';
      return { ctaUrl: booking || (ctx.appSettings?.signupLink ?? '') };
    }
    case 'acknowledge':
      return obs ? { ctaUrl: '', ackObservationId: obs.observationId } : { ctaUrl: '' };
    case 'fixedUrl':
      return { ctaUrl: step.buttonUrl };
    case 'none':
    default:
      return { ctaUrl: '' };
  }
}

export function deriveCheckpoints(
  steps: DashboardStep[],
  ctx: DeriveContext,
  now: Date = new Date(),
): CheckpointWithStatus[] {
  const ordered = steps.filter((s) => s.enabled).slice().sort((a, b) => a.order - b.order);
  const out: CheckpointWithStatus[] = [];
  let prevDone = false;

  for (const step of ordered) {
    const obs = resolveObservation(ctx, step.watchedKind);
    const done = evalDone(step.doneWhen, ctx, obs, now);
    const shown = evalShow(step.showWhen, ctx, obs, now, prevDone);
    prevDone = done;

    const emit = (shown || done) && !(done && step.hideWhenDone);
    if (!emit) continue;

    let status: CheckpointStatus;
    let percent: number | null = null;
    let percentLabel = '';
    if (done) {
      status = 'done';
    } else if (step.inProgress === 'responseProgress') {
      const { answered, total } = responseProgress(ctx, obs, step.watchedKind);
      if (answered > 0 && total > 0) {
        status = 'inprogress';
        percent = Math.min(100, Math.round((answered / total) * 100));
        percentLabel = `${String(answered)} of ${String(total)} answered`;
      } else {
        status = shown ? 'soon' : 'upcoming';
      }
    } else {
      status = shown ? 'soon' : 'upcoming';
    }

    const stepDate = DATE_SOURCE_FN[step.dateFrom](obs);
    const { ctaUrl, ackObservationId } = resolveButton(step, ctx, obs);
    const isAck = step.buttonTarget === 'acknowledge';

    out.push({
      id: step.id,
      key: step.id,
      type: step.chipStyle,
      typeLabel: step.chipLabel,
      title: step.title,
      desc: step.description,
      monthLabel: stepDate ? monthLabel(stepDate) : '',
      dateLabel: stepDate ? dateLabel(stepDate) : '',
      dueRelative: isAck && !done ? 'Action required' : '',
      cta: step.buttonLabel,
      ctaUrl,
      status,
      completedLabel: done && stepDate ? dateLabel(stepDate) : null,
      percent,
      percentLabel,
      ...(ackObservationId ? { ackObservationId } : {}),
    });
  }

  return out;
}

// ─── Small helpers used by the page shell (kept colocated) ───────────────────

export function initialsFromName(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] ?? '').toUpperCase() + (parts[1][0] ?? '').toUpperCase();
  }
  if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] ?? '?').toUpperCase();
}

export function extractFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  if (trimmed.includes(',')) {
    const afterComma = trimmed.split(',')[1]?.trim();
    if (afterComma) return afterComma.split(/\s+/)[0] ?? afterComma;
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ops/web exec vitest run src/dashboard/deriveCheckpoints.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/deriveCheckpoints.ts apps/web/src/dashboard/deriveCheckpoints.test.ts
git commit -m "feat(dashboard): interpret composed steps via event registry"
```

---

## Task 6: Wire `StaffDashboardPage` to `resolveSteps`

**Files:**
- Modify: `apps/web/src/dashboard/StaffDashboardPage.tsx`

No new unit test (integration verified by typecheck + the existing app). The page builds a `DeriveContext` inline and calls `deriveCheckpoints`.

- [ ] **Step 1: Update imports**

In `apps/web/src/dashboard/StaffDashboardPage.tsx`, add `resolveSteps` to the `@ops/shared` import list (alongside the existing `DashboardConfig`, etc.):

```ts
  resolveSteps,
```

- [ ] **Step 2: Compute `hasBookedSlot` next to `openBooking`**

Find the `openBooking` `useMemo` (around lines 168-174) and add, immediately after it:

```ts
  const hasBookedSlot = useMemo(() => {
    for (const w of myWindows ?? []) {
      const inv = w.invitees.find((i) => i.email.toLowerCase() === emailLower);
      if (inv?.bookedSlotId) return true;
    }
    return false;
  }, [myWindows, emailLower]);
```

- [ ] **Step 3: Replace the `deriveCheckpoints` call**

In the `tasks` `useMemo` (around lines 187-215), replace `deriveCheckpoints(config?.checkpoints ?? {}, { … })` with `resolveSteps(config)` as the first argument and add `hasBookedSlot` to the context object:

```ts
  const tasks = useMemo<CheckpointWithStatus[]>(() => {
    if (!staff) return [];
    return deriveCheckpoints(resolveSteps(config), {
      finalizedStandard: finalizedStandard,
      standardDraft,
      workProductDraft: wpDraft,
      instructionalRoundDraft: irDraft,
      finalizedWorkProduct: null,
      finalizedInstructionalRound: null,
      workProductQuestionsCount: wpQuestions.data?.length ?? 0,
      instructionalRoundQuestionsCount: wpQuestions.data?.length ?? 0,
      appSettings: appSettings ?? null,
      openBooking,
      hasBookedSlot,
      hasWorkProduct,
      hasInstructionalRound,
    });
  }, [
    staff,
    config,
    finalizedStandard,
    standardDraft,
    wpDraft,
    irDraft,
    wpQuestions.data,
    appSettings,
    openBooking,
    hasBookedSlot,
    hasWorkProduct,
    hasInstructionalRound,
  ]);
```

(Note the `finalizedStandard` key name fix and the added `hasBookedSlot` dep.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ops/web exec tsc --noEmit -p tsconfig.app.json`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/StaffDashboardPage.tsx
git commit -m "feat(dashboard): drive staff dashboard from composed steps"
```

---

## Task 7: `useDashboardDraft` holds `steps[]`

**Files:**
- Modify: `apps/web/src/admin/dashboard/useDashboardDraft.ts`

- [ ] **Step 1: Update imports + `DashboardDraft` shape**

In `apps/web/src/admin/dashboard/useDashboardDraft.ts`:

Replace the `DashboardCheckpointsConfig` import with `DashboardStep` + `resolveSteps`:

```ts
  type DashboardStep,
  resolveSteps,
```
(remove `type DashboardCheckpointsConfig` from the import).

Change the `DashboardDraft` interface field:

```ts
export interface DashboardDraft {
  sections: DashboardSectionsConfig;
  steps: DashboardStep[];
  quickMaterials: DashboardQuickMaterial[];
}
```

In `UseDashboardDraftResult`, replace `setCheckpoints` with:

```ts
  setSteps: (next: DashboardStep[]) => void;
```

- [ ] **Step 2: Update `freshDraft` + hydration**

Replace `freshDraft`:

```ts
function freshDraft(): DashboardDraft {
  return { sections: { ...DEFAULT_SECTIONS }, steps: [], quickMaterials: [] };
}
```

In the hydration `useEffect`, build `steps` via the migration:

```ts
    const next: DashboardDraft = {
      sections: { ...DEFAULT_SECTIONS, ...(stripIds(configDoc)?.sections ?? {}) },
      steps: resolveSteps(stripIds(configDoc)),
      quickMaterials: stripIds(quickDoc)?.items ?? [],
    };
```

- [ ] **Step 3: Update setters + save**

Replace `setCheckpoints` with:

```ts
  const setSteps = useCallback((next: DashboardStep[]) => {
    setDraft((d) => ({ ...d, steps: next }));
  }, []);
```

In `save`, change the config `setDoc` payload from `checkpoints: draft.checkpoints` to:

```ts
            steps: draft.steps,
```

In the returned object, replace `setCheckpoints` with `setSteps`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ops/web exec tsc --noEmit -p tsconfig.app.json`
Expected: FAILs only in `DashboardSettingsPage.tsx` / `CycleStepsEditor.tsx` (fixed in Tasks 10-11). The hook file itself must be error-free — confirm no errors reference `useDashboardDraft.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/admin/dashboard/useDashboardDraft.ts
git commit -m "feat(admin): dashboard draft stores composed steps + migrates legacy"
```

---

## Task 8: Interpreter-driven preview

**Files:**
- Modify: `apps/web/src/admin/dashboard/previewSampleData.ts`
- Modify: `apps/web/src/admin/dashboard/DashboardPreview.tsx`
- Test: add a case to `apps/web/src/dashboard/deriveCheckpoints.test.ts` is unnecessary; add a focused preview test below.
- Test: `apps/web/src/admin/dashboard/previewSampleData.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/admin/dashboard/previewSampleData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_STEPS } from '@ops/shared';
import { buildSampleCheckpoints } from './previewSampleData';

describe('buildSampleCheckpoints', () => {
  it('renders multiple seed cards for the representative sample staff member', () => {
    const cards = buildSampleCheckpoints(DEFAULT_STEPS);
    expect(cards.length).toBeGreaterThan(2);
    // disabling a step removes its card
    const fewer = buildSampleCheckpoints(
      DEFAULT_STEPS.map((s) => (s.id === 'preObs' ? { ...s, enabled: false } : s)),
    );
    expect(fewer.find((c) => c.id === 'preObs')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ops/web exec vitest run src/admin/dashboard/previewSampleData.test.ts`
Expected: FAIL — `buildSampleCheckpoints` still expects the old checkpoints-config arg / type error.

- [ ] **Step 3: Rewrite `previewSampleData.ts`**

Replace the entire contents of `apps/web/src/admin/dashboard/previewSampleData.ts` with:

```ts
import type { DashboardStep, Observation, Staff } from '@ops/shared';
import { deriveCheckpoints, type CheckpointWithStatus } from '@/dashboard/deriveCheckpoints';
import type { DeriveContext } from '@/dashboard/dashboardEvents';
import type { ModuleChip } from '@/dashboard/DashboardView';

/**
 * Synthesized "representative mid-cycle staff member" used by the admin
 * preview. The preview runs the REAL interpreter against this fixed context
 * so any step config (built-in or custom) renders exactly as staff would see
 * it. The sample exercises every watched kind and a spread of states.
 */

const PREVIEW_NOW = new Date('2026-03-15T00:00:00Z');
const PAST = new Date('2026-02-10T00:00:00Z');
const SOON = new Date('2026-03-20T00:00:00Z');

export const SAMPLE_STAFF: Staff = {
  email: 'jane.doe@orono.k12.mn.us',
  name: 'Jane Doe',
  role: 'teacher',
  year: 2,
  buildings: ['High School'],
  modules: ['mentor'],
  summativeYear: false,
  isActive: true,
  hasAdminAccess: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const SAMPLE_FIRST_NAME = 'Jane';
export const SAMPLE_YEAR_TIER_LABEL = 'Year 2';
export const SAMPLE_ROLE_DISPLAY_NAME = 'Teacher';
export const SAMPLE_BUILDING_NAMES = ['High School'];
export const SAMPLE_MODULE_CHIPS: ModuleChip[] = [
  { moduleId: 'mentor', displayName: 'Mentor', color: 'indigo' },
];

export const SAMPLE_PEER_EVALUATOR = {
  name: 'Sam Lee',
  email: 'sam.lee@orono.k12.mn.us',
  role: 'Peer Evaluator',
};

function sampleObs(partial: Partial<Observation>): Observation {
  return {
    observationId: 'sample-obs',
    status: 'Draft',
    createdAt: PAST,
    lastModifiedAt: PAST,
    finalizedAt: null,
    acknowledgedAt: null,
    ...partial,
  } as unknown as Observation;
}

/** Mid-cycle: pre-obs already happened, observation coming up, a partially
 *  answered work-product draft, and an active instructional round. */
const SAMPLE_CONTEXT: DeriveContext = {
  finalizedStandard: [],
  standardDraft: sampleObs({
    observationId: 'sample-standard',
    preObsDate: PAST,
    observationDate: SOON,
  }),
  workProductDraft: sampleObs({
    observationId: 'sample-wp',
    workProductAnswers: [
      { answer: 'done' },
      { answer: 'done' },
      { answer: 'done' },
      { answer: '' },
      { answer: '' },
    ] as unknown as Observation['workProductAnswers'],
  }),
  instructionalRoundDraft: sampleObs({ observationId: 'sample-ir' }),
  finalizedWorkProduct: null,
  finalizedInstructionalRound: null,
  workProductQuestionsCount: 5,
  instructionalRoundQuestionsCount: 5,
  appSettings: { signupLink: 'https://example.com/signup' } as never,
  openBooking: { windowId: 'sample-window', token: 'sample-token' },
  hasBookedSlot: false,
  hasWorkProduct: true,
  hasInstructionalRound: true,
};

export function buildSampleCheckpoints(steps: DashboardStep[]): CheckpointWithStatus[] {
  return deriveCheckpoints(steps, SAMPLE_CONTEXT, PREVIEW_NOW);
}
```

- [ ] **Step 4: Update `DashboardPreview.tsx`**

In `apps/web/src/admin/dashboard/DashboardPreview.tsx`:

Replace the `DashboardCheckpointsConfig` import with `DashboardStep`:

```ts
import { type DashboardQuickMaterial, type DashboardSectionsConfig, type DashboardStep } from '@ops/shared';
```

Change the prop type + usage:

```ts
export interface DashboardPreviewProps {
  sections: DashboardSectionsConfig;
  steps: DashboardStep[];
  quickMaterials: DashboardQuickMaterial[];
}

export function DashboardPreview({ sections, steps, quickMaterials }: DashboardPreviewProps) {
  const tasks = useMemo(() => buildSampleCheckpoints(steps), [steps]);
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @ops/web exec vitest run src/admin/dashboard/previewSampleData.test.ts`
Expected: PASS.

(Typecheck still fails in `DashboardSettingsPage.tsx`/`CycleStepsEditor.tsx` until Tasks 10-11.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/admin/dashboard/previewSampleData.ts apps/web/src/admin/dashboard/previewSampleData.test.ts apps/web/src/admin/dashboard/DashboardPreview.tsx
git commit -m "feat(admin): interpreter-driven dashboard preview"
```

---

## Task 9: Plain-language copy for the builder

**Files:**
- Modify: `apps/web/src/admin/dashboard/copyStrings.ts`

- [ ] **Step 1: Replace the cycle-steps copy**

In `apps/web/src/admin/dashboard/copyStrings.ts`:

Change the import line at top to drop the now-unused `CheckpointTypeKey`:

```ts
import type { DashboardSectionsConfig } from '@ops/shared';
```

Remove the `CheckpointCopy` interface, the `CHECKPOINT_COPY` map, `PHASE_ORDER`, `PhaseKey`, and `PHASE_DESCRIPTION` (all tied to the old fixed types). Replace the `// ── Cycle steps (checkpoints) ──` section through the end of the cycle-steps editor strings with:

```ts
// ── Step builder ─────────────────────────────────────────────────────────────

export const CS_HEADING = 'Dashboard steps';
export const CS_BLURB =
  'Each card on the staff dashboard is a step. A step appears when its "Show" event happens, turns complete when its "Done" event happens, and shows the date you choose. Drag to reorder; add or remove steps as your process changes.';
export const CS_ADD_STEP = 'Add step';
export const CS_DELETE_STEP = 'Delete step';
export const CS_SHOW_LABEL = 'Show this step to staff';
export const CS_EDIT_TOGGLE = 'Edit';
export const CS_EDIT_HIDE = 'Done editing';

export const CS_FIELD_CHIP_STYLE = 'Tag color';
export const CS_FIELD_CHIP = 'Tag text';
export const CS_FIELD_TITLE = 'Title';
export const CS_FIELD_DESC = 'Description';
export const CS_FIELD_BUTTON = 'Button text';
export const CS_FIELD_WATCHES = 'Watches which observation';
export const CS_FIELD_SHOW = 'Show this step';
export const CS_FIELD_DONE = 'Mark it done';
export const CS_FIELD_DATE = 'Show date from';
export const CS_FIELD_PROGRESS = 'Progress bar';
export const CS_FIELD_BUTTON_TARGET = 'Button goes to';
export const CS_FIELD_BUTTON_URL = 'Link address';
export const CS_FIELD_HIDE_DONE = 'Hide once done';

export const WATCHED_KIND_LABELS: Record<string, string> = {
  standard: 'Standard observation',
  workProduct: 'Work Product',
  instructionalRound: 'Instructional Round',
  any: 'Any observation',
};

export const SHOW_WHEN_LABELS: Record<string, string> = {
  always: 'Always',
  previousStepDone: 'After the previous step is done',
  observationCreated: 'When the observation is created',
  signupWindowOpened: 'When a sign-up window opens',
  signupSlotBooked: 'When the staff member books a slot',
  preObsDateSet: 'When the pre-observation date is set',
  preObsDatePassed: 'When the pre-observation date passes',
  observationDateSet: 'When the observation date is set',
  observationDatePassed: 'When the observation date passes',
  postObsDateSet: 'When the post-observation date is set',
  postObsDatePassed: 'When the post-observation date passes',
  finalized: 'When the observation is finalized',
  acknowledged: 'When the staff member acknowledges',
};

export const DONE_WHEN_LABELS: Record<string, string> = {
  never: 'Never (info only)',
  observationCreated: 'When the observation is created',
  signupWindowOpened: 'When a sign-up window opens',
  signupSlotBooked: 'When the staff member books a slot',
  preObsDateSet: 'When the pre-observation date is set',
  preObsDatePassed: 'When the pre-observation date passes',
  observationDateSet: 'When the observation date is set',
  observationDatePassed: 'When the observation date passes',
  postObsDateSet: 'When the post-observation date is set',
  postObsDatePassed: 'When the post-observation date passes',
  finalized: 'When the observation is finalized',
  acknowledged: 'When the staff member acknowledges',
};

export const DATE_SOURCE_LABELS: Record<string, string> = {
  none: 'No date',
  preObsDate: 'Pre-observation date',
  observationDate: 'Observation date',
  postObsDate: 'Post-observation date',
  finalizedAt: 'Finalized date',
  createdAt: 'Created date',
  lastModifiedAt: 'Last updated date',
};

export const IN_PROGRESS_LABELS: Record<string, string> = {
  none: 'No progress bar',
  responseProgress: 'Response form progress (answered ÷ total)',
};

export const BUTTON_TARGET_LABELS: Record<string, string> = {
  observation: 'The observation page',
  booking: 'The sign-up / booking page',
  acknowledge: 'The Acknowledge action',
  fixedUrl: 'A fixed link',
  none: 'No button',
};

export const CHIP_STYLE_LABELS: Record<string, string> = {
  form: 'Form (blue)',
  meeting: 'Meeting (blue)',
  observation: 'Observation (green)',
  review: 'Review (amber)',
};
```

Keep the existing `CS_PLACEHOLDER_DEFAULT` constant if present (used as input placeholder); if it was inside the removed block, re-add:

```ts
export const CS_PLACEHOLDER_DEFAULT = '(optional)';
```

- [ ] **Step 2: Typecheck the copy file in isolation**

Run: `pnpm --filter @ops/web exec tsc --noEmit -p tsconfig.app.json`
Expected: errors now only in `CycleStepsEditor.tsx` (it still imports the removed `CHECKPOINT_COPY`) and `DashboardSettingsPage.tsx`. Confirm no error originates in `copyStrings.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/copyStrings.ts
git commit -m "feat(admin): plain-language copy for the step builder"
```

---

## Task 10: Step-builder UI (`CycleStepsEditor.tsx`)

**Files:**
- Modify: `apps/web/src/admin/dashboard/CycleStepsEditor.tsx`

This is a full rewrite of the editor component. It keeps the existing `@dnd-kit` drag setup and `SortableItem`/`GripHandle` helpers.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `apps/web/src/admin/dashboard/CycleStepsEditor.tsx` with:

```tsx
import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import {
  DATE_SOURCES,
  DONE_WHEN_OPTIONS,
  IN_PROGRESS_SOURCES,
  SHOW_WHEN_OPTIONS,
  STEP_BUTTON_TARGETS,
  STEP_CHIP_STYLES,
  WATCHED_KINDS,
  dashboardStep,
  type DashboardStep,
} from '@ops/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  BUTTON_TARGET_LABELS,
  CHIP_STYLE_LABELS,
  CS_ADD_STEP,
  CS_BLURB,
  CS_DELETE_STEP,
  CS_EDIT_HIDE,
  CS_EDIT_TOGGLE,
  CS_FIELD_BUTTON,
  CS_FIELD_BUTTON_TARGET,
  CS_FIELD_BUTTON_URL,
  CS_FIELD_CHIP,
  CS_FIELD_CHIP_STYLE,
  CS_FIELD_DATE,
  CS_FIELD_DESC,
  CS_FIELD_DONE,
  CS_FIELD_HIDE_DONE,
  CS_FIELD_PROGRESS,
  CS_FIELD_SHOW,
  CS_FIELD_TITLE,
  CS_FIELD_WATCHES,
  CS_HEADING,
  CS_PLACEHOLDER_DEFAULT,
  CS_SHOW_LABEL,
  DATE_SOURCE_LABELS,
  DONE_WHEN_LABELS,
  IN_PROGRESS_LABELS,
  SHOW_WHEN_LABELS,
  WATCHED_KIND_LABELS,
} from './copyStrings';
import { GripHandle, SortableItem } from './SortableItem';

/**
 * Step builder. Renders the composed `DashboardStep[]` as a drag-reorderable
 * list. Each row toggles enable, shows the title, and expands to edit labels
 * and the logic slots via plain-language dropdowns.
 */

export function CycleStepsEditor({
  value,
  onChange,
}: {
  value: DashboardStep[];
  onChange: (next: DashboardStep[]) => void;
}) {
  const steps = [...value].sort((a, b) => a.order - b.order);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: DashboardStep[]) {
    onChange(next.map((s, idx) => ({ ...s, order: idx })));
  }

  function updateStep(id: string, patch: Partial<DashboardStep>) {
    commit(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const id = `step-${String(Date.now())}`;
    const created = dashboardStep.parse({
      id,
      order: steps.length,
      title: 'New step',
      chipLabel: 'Step',
      showWhen: 'always',
      doneWhen: 'never',
      buttonTarget: 'none',
    });
    commit([...steps, created]);
    setExpanded((s) => new Set(s).add(id));
  }

  function deleteStep(id: string) {
    commit(steps.filter((s) => s.id !== id));
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = steps.findIndex((s) => s.id === e.active.id);
    const newIndex = steps.findIndex((s) => s.id === e.over!.id); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(steps, oldIndex, newIndex));
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-foreground mb-1 text-base font-semibold">{CS_HEADING}</h3>
          <p className="text-muted-foreground text-sm">{CS_BLURB}</p>
        </div>
        <button
          type="button"
          onClick={addStep}
          className="bg-ops-blue inline-flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium text-white"
        >
          <Plus className="h-4 w-4" />
          {CS_ADD_STEP}
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {steps.map((step) => {
              const isExpanded = expanded.has(step.id);
              return (
                <SortableItem key={step.id} id={step.id}>
                  {({ dragHandleProps }) => (
                    <li className="border-border bg-background rounded-lg border">
                      <div className="flex items-start gap-2 p-3">
                        <GripHandle dragHandleProps={dragHandleProps} />
                        <div className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'text-sm font-semibold',
                              step.enabled ? 'text-foreground' : 'text-muted-foreground',
                            )}
                          >
                            {step.title || '(untitled step)'}
                          </span>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {SHOW_WHEN_LABELS[step.showWhen]} · {DONE_WHEN_LABELS[step.doneWhen]}
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleExpand(step.id)}
                            className="text-ops-blue hover:bg-ops-blue-lighter/40 mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                          >
                            {isExpanded ? CS_EDIT_HIDE : CS_EDIT_TOGGLE}
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        <ShowSwitch
                          on={step.enabled}
                          onChange={() => updateStep(step.id, { enabled: !step.enabled })}
                        />
                      </div>

                      {isExpanded ? (
                        <div className="bg-muted/30 grid gap-3 px-3 pb-3 md:grid-cols-2">
                          <TextField
                            label={CS_FIELD_TITLE}
                            value={step.title}
                            onChange={(v) => updateStep(step.id, { title: v })}
                          />
                          <TextField
                            label={CS_FIELD_CHIP}
                            value={step.chipLabel}
                            onChange={(v) => updateStep(step.id, { chipLabel: v })}
                          />
                          <TextField
                            label={CS_FIELD_DESC}
                            value={step.description}
                            onChange={(v) => updateStep(step.id, { description: v })}
                          />
                          <TextField
                            label={CS_FIELD_BUTTON}
                            value={step.buttonLabel}
                            onChange={(v) => updateStep(step.id, { buttonLabel: v })}
                          />
                          <SelectField
                            label={CS_FIELD_CHIP_STYLE}
                            value={step.chipStyle}
                            options={STEP_CHIP_STYLES}
                            labels={CHIP_STYLE_LABELS}
                            onChange={(v) => updateStep(step.id, { chipStyle: v as DashboardStep['chipStyle'] })}
                          />
                          <SelectField
                            label={CS_FIELD_WATCHES}
                            value={step.watchedKind}
                            options={WATCHED_KINDS}
                            labels={WATCHED_KIND_LABELS}
                            onChange={(v) => updateStep(step.id, { watchedKind: v as DashboardStep['watchedKind'] })}
                          />
                          <SelectField
                            label={CS_FIELD_SHOW}
                            value={step.showWhen}
                            options={SHOW_WHEN_OPTIONS}
                            labels={SHOW_WHEN_LABELS}
                            onChange={(v) => updateStep(step.id, { showWhen: v as DashboardStep['showWhen'] })}
                          />
                          <SelectField
                            label={CS_FIELD_DONE}
                            value={step.doneWhen}
                            options={DONE_WHEN_OPTIONS}
                            labels={DONE_WHEN_LABELS}
                            onChange={(v) => updateStep(step.id, { doneWhen: v as DashboardStep['doneWhen'] })}
                          />
                          <SelectField
                            label={CS_FIELD_DATE}
                            value={step.dateFrom}
                            options={DATE_SOURCES}
                            labels={DATE_SOURCE_LABELS}
                            onChange={(v) => updateStep(step.id, { dateFrom: v as DashboardStep['dateFrom'] })}
                          />
                          <SelectField
                            label={CS_FIELD_PROGRESS}
                            value={step.inProgress}
                            options={IN_PROGRESS_SOURCES}
                            labels={IN_PROGRESS_LABELS}
                            onChange={(v) => updateStep(step.id, { inProgress: v as DashboardStep['inProgress'] })}
                          />
                          <SelectField
                            label={CS_FIELD_BUTTON_TARGET}
                            value={step.buttonTarget}
                            options={STEP_BUTTON_TARGETS}
                            labels={BUTTON_TARGET_LABELS}
                            onChange={(v) =>
                              updateStep(step.id, { buttonTarget: v as DashboardStep['buttonTarget'] })
                            }
                          />
                          {step.buttonTarget === 'fixedUrl' ? (
                            <TextField
                              label={CS_FIELD_BUTTON_URL}
                              value={step.buttonUrl}
                              onChange={(v) => updateStep(step.id, { buttonUrl: v })}
                            />
                          ) : null}
                          <label className="flex items-center gap-2 text-xs font-medium">
                            <input
                              type="checkbox"
                              checked={step.hideWhenDone}
                              onChange={() => updateStep(step.id, { hideWhenDone: !step.hideWhenDone })}
                            />
                            {CS_FIELD_HIDE_DONE}
                          </label>
                          <button
                            type="button"
                            onClick={() => deleteStep(step.id)}
                            className="text-ops-red-dark hover:bg-ops-red-lighter/40 inline-flex items-center gap-1 justify-self-start rounded px-1.5 py-0.5 text-xs font-medium"
                          >
                            <Trash2 className="h-3 w-3" />
                            {CS_DELETE_STEP}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  )}
                </SortableItem>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function ShowSwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={CS_SHOW_LABEL}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-ops-blue' : 'bg-gray-300',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={CS_PLACEHOLDER_DEFAULT}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-input bg-background h-9 rounded-md border px-2 text-sm"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {labels[opt] ?? opt}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ops/web exec tsc --noEmit -p tsconfig.app.json`
Expected: errors now only in `DashboardSettingsPage.tsx` (still passes `checkpoints`/`setCheckpoints`). Confirm none originate in `CycleStepsEditor.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/CycleStepsEditor.tsx
git commit -m "feat(admin): composed-step builder UI"
```

---

## Task 11: Wire `DashboardSettingsPage`

**Files:**
- Modify: `apps/web/src/admin/dashboard/DashboardSettingsPage.tsx`

- [ ] **Step 1: Update the two bindings**

In `apps/web/src/admin/dashboard/DashboardSettingsPage.tsx`:

Change the steps-tab editor binding (around lines 121-123) from `draft.draft.checkpoints` / `draft.setCheckpoints` to:

```tsx
          {tab === 'steps' ? (
            <CycleStepsEditor value={draft.draft.steps} onChange={draft.setSteps} />
          ) : null}
```

Change the `DashboardPreview` binding (around lines 137-141) from `checkpoints={draft.draft.checkpoints}` to:

```tsx
          <DashboardPreview
            sections={draft.draft.sections}
            steps={draft.draft.steps}
            quickMaterials={draft.draft.quickMaterials}
          />
```

- [ ] **Step 2: Full web typecheck**

Run: `pnpm --filter @ops/web exec tsc --noEmit -p tsconfig.app.json`
Expected: exits 0 (whole web app typechecks).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/DashboardSettingsPage.tsx
git commit -m "feat(admin): wire dashboard settings page to step builder"
```

---

## Task 12: Full validation

**Files:** none (verification)

- [ ] **Step 1: Run the full web + shared test suites**

Run: `pnpm --filter @ops/shared exec vitest run && pnpm --filter @ops/web exec vitest run`
Expected: all PASS.

- [ ] **Step 2: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 3: Lint + format-check the changed files**

Run: `pnpm lint`
Expected: 0 errors (per repo rule `--max-warnings 0`).

Run (git-normalized format check, per the Windows CRLF caveat — verifies what CI sees):
```bash
for f in $(git diff --name-only HEAD~10 -- '*.ts' '*.tsx'); do git cat-file -p :"$f" | pnpm exec prettier --check --stdin-filepath "$f"; done
```
Expected: every file "All matched files use Prettier code style!" / no diffs.

- [ ] **Step 4: Manual smoke (the implementer should confirm)**

Start dev (`pnpm dev`), sign in as an admin, open `/admin/dashboard` → "Dashboard steps":
- The 8 seed steps render; toggling, reordering, editing slots, adding, and deleting all update the live preview.
- Switch to a staff dashboard: cards still render as before, with pre-obs/observation/post-obs completing once their dates pass.

- [ ] **Step 5: Final commit (if any format/lint fixups were needed)**

```bash
git add -A
git commit -m "chore(dashboard): lint/format fixups for step builder" || echo "nothing to commit"
```

---

## Self-Review Notes (for the planner)

- **Spec coverage:** schema (Task 1), seeds + migration (Task 2), interpreter + registry (Tasks 4-5), `hasBookedSlot`/`signupSlotBooked` thread-through (Tasks 4, 6), staff page (Task 6), draft + migration (Task 7), interpreter-driven preview (Task 8), plain-language copy (Task 9), builder UI (Task 10), settings wiring (Task 11), tests throughout, full validation (Task 12). The module-assignment subsystem is intentionally out of scope (separate stub).
- **Type consistency:** `DeriveContext` is defined once in `dashboardEvents.ts` and re-exported by `deriveCheckpoints.ts`; `CheckpointWithStatus.key` relaxed to `string` (no downstream branching on it, verified). `deriveCheckpoints(steps, ctx, now?)` signature used consistently in Tasks 5, 6, 8 and all tests.
- **Legacy fields:** `checkpoints`/`DashboardCheckpointConfig` stay in the schema for read-time migration only; never written after the first save.
```
