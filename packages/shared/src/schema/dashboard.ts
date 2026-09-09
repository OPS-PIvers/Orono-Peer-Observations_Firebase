import { z } from 'zod';
import { email, isoDate } from './common.js';
import { dashboardMaterialAudience, emptyAudience } from './dashboardAudience.js';

/**
 * Staff Dashboard configuration.
 *
 * The dashboard itself is fully derived from real data — observations,
 * staff metadata, app settings. Admins do NOT type in titles, dates,
 * descriptions, or status. They configure:
 *
 *   - Which checkpoint *types* are enabled (and in what order)
 *   - Optional display label overrides per type (chip text / title / CTA verb)
 *   - Which top-level dashboard sections are visible
 *   - The Quick Materials list (right-rail evergreen URLs — admins paste
 *     Drive/handbook/rubric links here, as before)
 *
 * Per-checkpoint dates and status come from the staff member's
 * observations and the app settings (e.g. `signupLink`) at render time.
 */

// ─── Material icon enum (kept for quick-materials chips/list) ────────────────

export const MATERIAL_ICONS = [
  'pdf',
  'doc',
  'form',
  'folder',
  'calendar',
  'rubric',
  'book',
  'help',
  'video',
] as const;
export type MaterialIcon = (typeof MATERIAL_ICONS)[number];
export const materialIcon = z.enum(MATERIAL_ICONS);

// ─── Built-in checkpoint types ──────────────────────────────────────────────
// Each maps to specific Firestore state on the dashboard. Builders in the
// web app keyed on this enum decide whether a checkpoint applies to a given
// staff member and what its status/date are.

export const CHECKPOINT_TYPE_KEYS = [
  'signup',
  'preObs',
  'observation',
  'reviewDraft',
  'postObs',
  'acknowledge',
  'workProduct',
  'instructionalRound',
] as const;
export type CheckpointTypeKey = (typeof CHECKPOINT_TYPE_KEYS)[number];
export const checkpointTypeKey = z.enum(CHECKPOINT_TYPE_KEYS);

/** Visual "type chip" style for the card. Maps to the prototype's four
 *  pre-defined chip colors (form, meeting, observation, review). */
export const CHECKPOINT_VISUAL_TYPES = ['form', 'meeting', 'observation', 'review'] as const;
export type CheckpointVisualType = (typeof CHECKPOINT_VISUAL_TYPES)[number];
export const checkpointVisualType = z.enum(CHECKPOINT_VISUAL_TYPES);

// ─── Per-type admin settings ─────────────────────────────────────────────────

export const dashboardCheckpointConfig = z.object({
  enabled: z.boolean().default(true),
  /** Sort position (lower = earlier). Two entries with the same order
   *  fall back to the enum-declaration order. */
  order: z.number().int().nonnegative().default(0),
  /** Override the human label for the type chip (e.g. "Self-reflection",
   *  "Meeting"). Empty string = use the built-in default for the type. */
  typeLabelOverride: z.string().trim().max(40).default(''),
  /** Override the card title. Empty string = built-in default. */
  titleOverride: z.string().trim().max(160).default(''),
  /** Override the CTA verb on the button. Empty string = built-in default. */
  ctaLabelOverride: z.string().trim().max(40).default(''),
});
export type DashboardCheckpointConfig = z.infer<typeof dashboardCheckpointConfig>;

// ─── Section toggles ─────────────────────────────────────────────────────────

export const dashboardSectionsConfig = z.object({
  hero: z.boolean().default(true),
  roleChip: z.boolean().default(true),
  progressSummary: z.boolean().default(true),
  statBar: z.boolean().default(true),
  timeline: z.boolean().default(true),
  filterBar: z.boolean().default(true),
  quickMaterials: z.boolean().default(true),
  peerEvaluatorCard: z.boolean().default(true),
});
export type DashboardSectionsConfig = z.infer<typeof dashboardSectionsConfig>;

// ─── Whole-dashboard config doc ──────────────────────────────────────────────

/** Per-type overrides keyed by CheckpointTypeKey. Optional in the Firestore
 *  payload — missing entries fall back to defaults at the consumer site. */
export const dashboardCheckpointsConfig = z.object({
  signup: dashboardCheckpointConfig.optional(),
  preObs: dashboardCheckpointConfig.optional(),
  observation: dashboardCheckpointConfig.optional(),
  reviewDraft: dashboardCheckpointConfig.optional(),
  postObs: dashboardCheckpointConfig.optional(),
  acknowledge: dashboardCheckpointConfig.optional(),
  workProduct: dashboardCheckpointConfig.optional(),
  instructionalRound: dashboardCheckpointConfig.optional(),
});
export type DashboardCheckpointsConfig = z.infer<typeof dashboardCheckpointsConfig>;

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
  /** The calendar day after the observation date has begun — the moment the
   *  observed staff member's Reflection questions open (see
   *  `postQuestionsUnlocked` in workProductQuestion.ts). */
  'postQuestionsUnlocked',
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
  /** The open self-scheduling window's `endDate` (booking deadline), not
   *  anything on the observation itself. See DeriveContext.openBooking. */
  'windowEndDate',
] as const;
export type DateSource = (typeof DATE_SOURCES)[number];

export const IN_PROGRESS_SOURCES = ['none', 'responseProgress'] as const;
export type InProgressSource = (typeof IN_PROGRESS_SOURCES)[number];

export const WATCHED_KINDS = [
  'standard',
  'workProduct',
  'instructionalRound',
  'any',
  /** First active draft across kinds; never resolves to a finalized observation.
   *  Use for "review the draft"-style cards that should re-show when a new
   *  draft is opened even if a prior cycle's observation has been finalized. */
  'anyDraft',
  /** Most recent finalized Standard observation, ignoring drafts. Use for
   *  post-finalize steps (e.g. acknowledge) that must keep pointing at the
   *  finalized record even after a new cycle's draft is opened. */
  'standardFinalized',
  /** The live draft of any type, else the most recent finalized observation.
   *  Use for steps that belong to every observation type (the Planning /
   *  Reflection question cards): `any` resolves finalized-first, so a prior
   *  cycle's finalized record would shadow the new draft forever. */
  'anyDraftFirst',
] as const;
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

/** Which Planning / Reflection panel a step's button opens on the observation
 *  page (`/observations/:id#planning` / `#reflection`). Also scopes
 *  `responseProgress` to that panel's questions. */
export const STEP_OPEN_PANELS = ['planning', 'reflection'] as const;
export type StepOpenPanel = (typeof STEP_OPEN_PANELS)[number];

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
  /** Optional: open a specific panel on the observation page and count only
   *  that panel's questions in `responseProgress`. Null = neither. */
  openPanel: z.enum(STEP_OPEN_PANELS).nullable().default(null),
});
export type DashboardStep = z.infer<typeof dashboardStep>;

export const dashboardConfig = z.object({
  sections: dashboardSectionsConfig.default({
    hero: true,
    roleChip: true,
    progressSummary: true,
    statBar: true,
    timeline: true,
    filterBar: true,
    quickMaterials: true,
    peerEvaluatorCard: true,
  }),
  checkpoints: dashboardCheckpointsConfig.default({}),
  steps: z.array(dashboardStep).default([]),
  /** Admin-configurable cycle close date label shown in the hero banner (e.g., "May 15").
   *  Falls back to "May 15" if not set. */
  cycleCloseLabel: z.string().trim().max(50).default('May 15'),
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type DashboardConfig = z.infer<typeof dashboardConfig>;

/** Doc id under /appSettings — same collection as global app settings. */
export const DASHBOARD_CONFIG_DOC_ID = 'dashboard';

// ─── Quick materials (right-rail evergreen URLs) — unchanged from before ─────

export const dashboardQuickMaterial = z.object({
  label: z.string().trim().min(1).max(120),
  sub: z.string().trim().max(200).default(''),
  icon: materialIcon.default('doc'),
  url: z.string().trim().max(2048).default(''),
  /** Who sees the card. Empty (the default) = everyone. See dashboardAudience.ts. */
  audience: dashboardMaterialAudience.default(emptyAudience()),
});
export type DashboardQuickMaterial = z.infer<typeof dashboardQuickMaterial>;

export const dashboardQuickMaterialsDoc = z.object({
  items: z.array(dashboardQuickMaterial).default([]),
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type DashboardQuickMaterialsDoc = z.infer<typeof dashboardQuickMaterialsDoc>;

export const DASHBOARD_QUICK_MATERIALS_DOC_ID = 'global';

// ─── Seed steps + legacy migration ───────────────────────────────────────────

/** The built-ins as editable seed steps. Planning and Reflection carry both
 *  the meeting date and the observed staff member's question progress for
 *  that phase, and deep-link into the matching panel on the observation
 *  page — every observation type has questions, so there is no separate
 *  Work Product / Instructional Round card any more.
 *
 *  Changing this array does NOT change production on its own: a saved
 *  `steps` array wins verbatim (see resolveSteps). Run
 *  scripts/migrate-dashboard-steps.mjs after editing. */
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
    // Booking a slot is what completes this step — NOT the mere existence of
    // an observation. `observationCreated` was wrong: a peer evaluator can
    // create an observation by hand, with no window and no sign-up involved,
    // and that used to mark this step complete. The card then sat on the
    // dashboard as a done step with no date and no button, because
    // `windowEndDate` and the booking URL both resolve through `openBooking`,
    // which is null when there is no window.
    doneWhen: 'signupSlotBooked',
    dateFrom: 'windowEndDate',
    buttonTarget: 'booking',
  }),
  dashboardStep.parse({
    id: 'preObs',
    order: 1,
    // Every observation type has Planning questions, so track the live draft
    // whatever its type.
    watchedKind: 'anyDraftFirst',
    chipStyle: 'meeting',
    chipLabel: 'Planning',
    title: 'Planning',
    description:
      'Answer your planning questions and meet with your peer evaluator about the lesson, focus components, and context.',
    buttonLabel: 'Open Planning',
    // Surfaces as soon as the draft exists — the questions are answerable
    // from that moment, so there is real work on the card even before the
    // evaluator has scheduled the conversation.
    showWhen: 'observationCreated',
    doneWhen: 'preObsDatePassed',
    dateFrom: 'preObsDate',
    inProgress: 'responseProgress',
    buttonTarget: 'observation',
    openPanel: 'planning',
  }),
  dashboardStep.parse({
    id: 'observation',
    order: 2,
    watchedKind: 'standard',
    chipStyle: 'observation',
    chipLabel: 'Observation',
    title: 'Classroom observation',
    description: 'Your peer evaluator joins your room during the window you selected.',
    buttonLabel: 'View details',
    showWhen: 'observationDateSet',
    doneWhen: 'observationDatePassed',
    dateFrom: 'observationDate',
    buttonTarget: 'observation',
  }),
  dashboardStep.parse({
    id: 'reviewDraft',
    order: 3,
    // anyDraft (never finalized) makes the step re-show for a fresh draft even
    // if a prior cycle's observation is already finalized.
    watchedKind: 'anyDraft',
    chipStyle: 'review',
    chipLabel: 'Review',
    title: 'Review the draft observation',
    description: 'Your peer evaluator is drafting your observation. You can view and comment now.',
    buttonLabel: 'Open draft',
    showWhen: 'observationCreated',
    doneWhen: 'finalized',
    dateFrom: 'lastModifiedAt',
    // hideWhenDone is unnecessary here: anyDraft resolves to null when no draft
    // exists, so the card simply skips emission once finalization happens.
    buttonTarget: 'observation',
  }),
  dashboardStep.parse({
    id: 'postObs',
    order: 4,
    watchedKind: 'anyDraftFirst',
    chipStyle: 'meeting',
    chipLabel: 'Reflection',
    title: 'Reflection',
    description:
      'Answer your reflection questions and talk through proficiency ratings and where to focus next.',
    buttonLabel: 'Open Reflection',
    // The Reflection questions open the day after the observation; that is
    // when this card has something to do, whether or not the evaluator has
    // scheduled the conversation yet.
    showWhen: 'postQuestionsUnlocked',
    doneWhen: 'postObsDatePassed',
    dateFrom: 'postObsDate',
    inProgress: 'responseProgress',
    buttonTarget: 'observation',
    openPanel: 'reflection',
  }),
  dashboardStep.parse({
    id: 'acknowledge',
    order: 5,
    // standardFinalized, not standard: `standard` resolves draft-first, so a
    // newly opened draft would hide an as-yet-unacknowledged finalized record.
    watchedKind: 'standardFinalized',
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
];

/** Merge a legacy per-type checkpoint override onto a seed step by id. */
export function applyLegacyOverride(
  seed: DashboardStep,
  legacy: DashboardCheckpointConfig | undefined,
): DashboardStep {
  if (!legacy) return seed;
  // Zod's `.default(...)` makes every field on DashboardCheckpointConfig
  // non-nullable in the output type, but Firestore reads bypass Zod defaults —
  // older or partial docs may lack any of these fields. The `??` fallbacks
  // are runtime safety despite what the types claim.
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  return {
    ...seed,
    enabled: legacy.enabled ?? true,
    order: legacy.order ?? seed.order,
    chipLabel: (legacy.typeLabelOverride ?? '').trim() || seed.chipLabel,
    title: (legacy.titleOverride ?? '').trim() || seed.title,
    buttonLabel: (legacy.ctaLabelOverride ?? '').trim() || seed.buttonLabel,
  };
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */
}

/** Resolve the effective step list from a (possibly legacy) config doc. */
export function resolveSteps(config: DashboardConfig | null | undefined): DashboardStep[] {
  if (config?.steps && config.steps.length > 0) return config.steps;
  const legacy = config?.checkpoints;
  return DEFAULT_STEPS.map((seed) =>
    applyLegacyOverride(seed, legacy?.[seed.id as CheckpointTypeKey]),
  );
}
