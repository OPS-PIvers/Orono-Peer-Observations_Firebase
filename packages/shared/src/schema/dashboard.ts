import { z } from 'zod';
import { email, isoDate } from './common.js';

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

export const WATCHED_KINDS = [
  'standard',
  'workProduct',
  'instructionalRound',
  'any',
  /** First active draft across kinds; never resolves to a finalized observation.
   *  Use for "review the draft"-style cards that should re-show when a new
   *  draft is opened even if a prior cycle's observation has been finalized. */
  'anyDraft',
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
