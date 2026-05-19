import { z } from 'zod';
import { email, isoDate } from './common.js';

/**
 * Staff Dashboard — checkpoint template + per-staff progress.
 *
 * The dashboard is configured centrally (by peer evaluators and admins) and
 * rendered per-staff on /dashboard. Two tiers of templates:
 *
 *   - "continuing" — years 1–3 (continuing contract)
 *   - "probationary" — years 4–6 (P1–P3)
 *
 * Each tier has an ordered list of checkpoints (self-reflection, sign-up,
 * pre-obs, work product, observation, review, post-obs, etc.). The same
 * checkpoint shape is used to render the timeline, the "Next up" card, and
 * the In-progress / Upcoming / Completed lists.
 *
 * Per-staff progress lives in /staffDashboardProgress/{email} so the
 * template can be reused across the year-tier population without forcing
 * the template to be copied into every staff document.
 */

// ─── Icon and type enums ─────────────────────────────────────────────────────

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

export const CHECKPOINT_TYPES = ['form', 'meeting', 'observation', 'review'] as const;
export type CheckpointType = (typeof CHECKPOINT_TYPES)[number];
export const checkpointType = z.enum(CHECKPOINT_TYPES);

export const TRIMESTERS = ['fall', 'winter', 'spring'] as const;
export type Trimester = (typeof TRIMESTERS)[number];
export const trimester = z.enum(TRIMESTERS);

export const DASHBOARD_TIERS = ['continuing', 'probationary'] as const;
export type DashboardTier = (typeof DASHBOARD_TIERS)[number];
export const dashboardTier = z.enum(DASHBOARD_TIERS);

// ─── Material reference ──────────────────────────────────────────────────────
// `url` is the only required pointer — admins paste a Drive share link or
// any HTTPS URL. Empty url = informational chip (no click target).

export const dashboardMaterial = z.object({
  label: z.string().trim().min(1).max(120),
  icon: materialIcon.default('doc'),
  url: z.string().trim().max(2048).default(''),
});
export type DashboardMaterial = z.infer<typeof dashboardMaterial>;

// ─── Checkpoint definition (template-level, no per-staff state) ──────────────

export const dashboardCheckpoint = z.object({
  id: z.string().min(1).max(64),
  type: checkpointType,
  typeLabel: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  desc: z.string().trim().max(600).default(''),
  trimester,
  /** Short month label shown above the dot, e.g. "Sept", "Nov". */
  monthLabel: z.string().trim().min(1).max(12),
  /** Full date label shown under active dots / on cards, e.g. "Sept 15". */
  dateLabel: z.string().trim().min(1).max(40),
  /** ISO date used by the auto-progress logic to decide done/soon/upcoming. */
  dueDate: isoDate.nullable().default(null),
  cta: z.string().trim().min(1).max(40).default('Open'),
  /** Where the primary CTA navigates. Empty = no-op (placeholder cta). */
  ctaUrl: z.string().trim().max(2048).default(''),
  materials: z.array(dashboardMaterial).default([]),
});
export type DashboardCheckpoint = z.infer<typeof dashboardCheckpoint>;

// ─── Template document (one per tier) ────────────────────────────────────────

export const dashboardTemplate = z.object({
  tier: dashboardTier,
  /** Eyebrow shown above the hero greeting, e.g. "Summative cycle · 2026–27". */
  cycleLabel: z.string().trim().min(1).max(80),
  /** Hero meta label, e.g. "Year 3" or "Probationary Year 2 (P2)". */
  yearTierLabel: z.string().trim().min(1).max(80),
  /** Right-edge meta of the hero, e.g. "May 15". */
  cycleCloseLabel: z.string().trim().min(1).max(40).default('May 15'),
  /** Whether this tier counts as a summative cycle (informational). */
  summativeYear: z.boolean().default(true),
  /** Expected number of observations per year (hero meta). */
  observationsPerYear: z.number().int().nonnegative().max(10).default(2),
  /** Ordered list of checkpoints rendered top-to-bottom. */
  checkpoints: z.array(dashboardCheckpoint).default([]),
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type DashboardTemplate = z.infer<typeof dashboardTemplate>;

export const dashboardTemplateInput = dashboardTemplate.omit({ updatedAt: true });
export type DashboardTemplateInput = z.infer<typeof dashboardTemplateInput>;

// ─── Quick materials (global sidebar list) ───────────────────────────────────

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

// ─── Per-staff progress ──────────────────────────────────────────────────────

export const dashboardCheckpointProgress = z.object({
  /** When the staff member (or a PE) marked this checkpoint complete. */
  completedAt: isoDate.nullable().default(null),
  completedBy: email.optional(),
  /** Optional 0–100 percent for "in progress" checkpoints (e.g. work-product
   *  answers in progress). When set, overrides the auto-derived status. */
  percent: z.number().int().min(0).max(100).nullable().default(null),
  /** Short label shown next to the percent, e.g. "3 of 5 answered". */
  percentLabel: z.string().trim().max(80).default(''),
});
export type DashboardCheckpointProgress = z.infer<typeof dashboardCheckpointProgress>;

export const dashboardProgress = z.object({
  email,
  /** Map of checkpoint id → progress. Missing entries default to upcoming. */
  checkpoints: z.record(z.string().min(1), dashboardCheckpointProgress).default({}),
  /** Optional denormalized peer evaluator info for the sidebar card. Empty
   *  fields render a "Not yet assigned" placeholder. */
  peerEvaluator: z
    .object({
      name: z.string().trim().max(120).default(''),
      email: z.string().trim().max(200).default(''),
      role: z.string().trim().max(120).default(''),
      phone: z.string().trim().max(60).default(''),
      hours: z.string().trim().max(120).default(''),
    })
    .default({ name: '', email: '', role: '', phone: '', hours: '' }),
  updatedAt: isoDate,
});
export type DashboardProgress = z.infer<typeof dashboardProgress>;
