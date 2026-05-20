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
