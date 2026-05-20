import {
  CHECKPOINT_TYPE_KEYS,
  OBSERVATION_STATUS,
  type AppSettings,
  type CheckpointTypeKey,
  type CheckpointVisualType,
  type DashboardCheckpointConfig,
  type DashboardCheckpointsConfig,
  type Observation,
} from '@ops/shared';

/**
 * Dashboard checkpoint derivation.
 *
 * Pure function that takes the admin's enabled-feature config plus the
 * staff member's real Firestore state (their observations, app settings)
 * and produces the ordered list of checkpoints the dashboard should show.
 *
 * No data is fabricated: every date, every status, every progress
 * percentage comes from an existing artifact in the system. The admin
 * configures which checkpoint *types* to include and any display-label
 * overrides; everything else is observed at render time.
 */

// ─── Status enum (matches the prototype's CSS classes) ───────────────────────

export type CheckpointStatus = 'done' | 'inprogress' | 'soon' | 'upcoming';

export interface CheckpointWithStatus {
  /** Stable id used as React key and for the timeline. */
  id: string;
  /** Which built-in type generated this entry — surfaces to the type chip
   *  color and to admins reading logs. */
  key: CheckpointTypeKey;
  /** Visual chip variant (drives `.task__type-chip--<x>` class). */
  type: CheckpointVisualType;
  /** Small uppercase label inside the chip. */
  typeLabel: string;
  /** Card title. */
  title: string;
  /** Optional descriptive paragraph (short helper text). */
  desc: string;
  /** Short month abbreviation shown above the timeline dot. */
  monthLabel: string;
  /** Full date label shown on the card and below active timeline dots. */
  dateLabel: string;
  /** Relative phrase like "In 6 days", "Tomorrow" — empty when unknown. */
  dueRelative: string;
  /** CTA verb on the action button. */
  cta: string;
  /** Where the CTA links. Empty = render as inert button. */
  ctaUrl: string;
  /** Status drives card layout (check icon style, color, NEXT UP banner). */
  status: CheckpointStatus;
  /** Set when status === 'done'; shown in the "Completed" column. */
  completedLabel: string | null;
  /** 0–100 for inprogress checkpoints, null otherwise. */
  percent: number | null;
  /** Label next to the percent, e.g. "3 of 5 answered". */
  percentLabel: string;
  /** Optional Acknowledge action — present only on the acknowledge card. */
  ackObservationId?: string;
}

// ─── Built-in defaults per checkpoint type ───────────────────────────────────

interface BuiltinDefaults {
  type: CheckpointVisualType;
  typeLabel: string;
  title: string;
  cta: string;
  defaultOrder: number;
}

const BUILTIN_DEFAULTS: Record<CheckpointTypeKey, BuiltinDefaults> = {
  signup: {
    type: 'meeting',
    typeLabel: 'Scheduling',
    title: 'Sign up for an observation window',
    cta: 'Choose a window',
    defaultOrder: 0,
  },
  preObs: {
    type: 'meeting',
    typeLabel: 'Meeting',
    title: 'Pre-observation conversation',
    cta: 'View meeting',
    defaultOrder: 1,
  },
  workProduct: {
    type: 'form',
    typeLabel: 'Evidence',
    title: 'Submit work-product responses',
    cta: 'Continue answering',
    defaultOrder: 2,
  },
  observation: {
    type: 'observation',
    typeLabel: 'Observation',
    title: 'Classroom observation',
    cta: 'View details',
    defaultOrder: 3,
  },
  reviewDraft: {
    type: 'review',
    typeLabel: 'Review',
    title: 'Review the draft observation',
    cta: 'Open draft',
    defaultOrder: 4,
  },
  postObs: {
    type: 'meeting',
    typeLabel: 'Meeting',
    title: 'Post-observation conversation',
    cta: 'View meeting',
    defaultOrder: 5,
  },
  acknowledge: {
    type: 'review',
    typeLabel: 'Sign-off',
    title: 'Acknowledge the finalized observation',
    cta: 'Acknowledge',
    defaultOrder: 6,
  },
  instructionalRound: {
    type: 'observation',
    typeLabel: 'Round',
    title: 'Instructional Round',
    cta: 'View details',
    defaultOrder: 7,
  },
};

function pickOverride(override: string | undefined, fallback: string): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

/** Merge admin overrides over the built-in defaults. */
function resolveLabels(
  key: CheckpointTypeKey,
  cfg: DashboardCheckpointConfig | undefined,
): { type: CheckpointVisualType; typeLabel: string; title: string; cta: string; order: number } {
  const b = BUILTIN_DEFAULTS[key];
  return {
    type: b.type,
    typeLabel: pickOverride(cfg?.typeLabelOverride, b.typeLabel),
    title: pickOverride(cfg?.titleOverride, b.title),
    cta: pickOverride(cfg?.ctaLabelOverride, b.cta),
    order: cfg?.order ?? b.defaultOrder,
  };
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function toDate(value: Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const maybe = value as unknown as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short' });
}

// ─── Context passed to builders ──────────────────────────────────────────────

export interface DeriveContext {
  /** All visible Finalized observations for this staff member, newest first. */
  finalizedStandard: Observation[];
  /** Active (Draft) Standard observation, if any — surfaces pre/obs/post
   *  cards before the observation is finalized. */
  standardDraft: Observation | null;
  /** Active (Draft) Work Product observation, if any. */
  workProductDraft: Observation | null;
  /** Active (Draft) Instructional Round observation, if any. */
  instructionalRoundDraft: Observation | null;
  /** Latest finalized Work Product, for status="done". */
  finalizedWorkProduct: Observation | null;
  /** Latest finalized Instructional Round, for status="done". */
  finalizedInstructionalRound: Observation | null;
  /** Total active question count for the work-product progress bar. */
  workProductQuestionsCount: number;
  /** Same, for instructional round. */
  instructionalRoundQuestionsCount: number;
  /** appSettings/global doc; surfaces signupLink etc. */
  appSettings: AppSettings | null;
  /** An open observation window the staff member is invited to but hasn't
   *  booked yet — deep-links the signup checkpoint straight to /book. */
  openBooking: { windowId: string; token: string } | null;
  /** Whether the staff member's role/year currently has WP / IR feature on. */
  hasWorkProduct: boolean;
  hasInstructionalRound: boolean;
}

// ─── Builders ────────────────────────────────────────────────────────────────

type Builder = (ctx: DeriveContext) => Omit<CheckpointWithStatus, 'key'> | null;

const BUILDERS: Record<CheckpointTypeKey, Builder> = {
  signup: (ctx) => {
    const labels = BUILTIN_DEFAULTS.signup;
    // The moment any observation (Draft or Finalized) exists for the staff
    // member, signup transitions to "Scheduled". Until then the link to the
    // signup form is the action.
    const hasObs = ctx.standardDraft != null || ctx.finalizedStandard.length > 0;
    // Prefer an in-app booking link when the staff member has an open invite;
    // otherwise fall back to the external signup link from settings.
    const bookingUrl = ctx.openBooking
      ? `/book/${ctx.openBooking.windowId}?token=${ctx.openBooking.token}`
      : '';
    const signupLink = ctx.appSettings?.signupLink ?? '';
    const ctaUrl = bookingUrl || signupLink;
    return {
      id: 'signup',
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      desc: 'Pick a window that works for your class. Your peer evaluator confirms within 2 school days.',
      monthLabel: '',
      dateLabel: hasObs ? 'Scheduled' : 'Open',
      dueRelative: '',
      cta: labels.cta,
      ctaUrl,
      status: hasObs ? 'done' : ctaUrl ? 'soon' : 'upcoming',
      completedLabel: hasObs ? 'Scheduled' : null,
      percent: null,
      percentLabel: '',
    };
  },

  preObs: (ctx) => {
    // Surface as soon as a Standard observation (Draft or Finalized) exists.
    // If the PE hasn't picked a date yet, show an "awaiting date" state.
    const finalized = ctx.finalizedStandard[0] ?? null;
    const draft = ctx.standardDraft;
    const obs = finalized ?? draft;
    if (!obs) return null;
    const preDate = toDate(obs.preObsDate);
    const labels = BUILTIN_DEFAULTS.preObs;
    const isFinal = finalized != null;
    return {
      id: 'preObs',
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      desc: '20-minute conversation with your peer evaluator. Lesson plan, focus components, context.',
      monthLabel: preDate ? monthLabel(preDate) : '',
      dateLabel: preDate ? dateLabel(preDate) : 'Awaiting date',
      dueRelative: '',
      cta: labels.cta,
      ctaUrl: `/observations/${obs.observationId}`,
      status: isFinal && preDate ? 'done' : preDate ? 'soon' : 'upcoming',
      completedLabel: isFinal && preDate ? dateLabel(preDate) : null,
      percent: null,
      percentLabel: '',
    };
  },

  observation: (ctx) => {
    const finalized = ctx.finalizedStandard[0] ?? null;
    const draft = ctx.standardDraft;
    const obs = finalized ?? draft;
    if (!obs) return null;
    const obsDate = toDate(obs.observationDate);
    const labels = BUILTIN_DEFAULTS.observation;
    const isFinal = finalized != null;
    return {
      id: 'observation',
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      desc: 'Your peer evaluator joins your room during the window you selected.',
      monthLabel: obsDate ? monthLabel(obsDate) : '',
      dateLabel: obsDate ? dateLabel(obsDate) : 'Awaiting date',
      dueRelative: '',
      cta: labels.cta,
      ctaUrl: `/observations/${obs.observationId}`,
      status: isFinal && obsDate ? 'done' : obsDate ? 'soon' : 'upcoming',
      completedLabel: isFinal && obsDate ? dateLabel(obsDate) : null,
      percent: null,
      percentLabel: '',
    };
  },

  reviewDraft: (ctx) => {
    // Staff can read Drafts of any observation during the cycle. The
    // "review draft" card lights up while any observation is Draft.
    const obs = ctx.standardDraft ?? ctx.workProductDraft ?? ctx.instructionalRoundDraft;
    if (!obs) return null;
    const lastMod = toDate(obs.lastModifiedAt);
    const labels = BUILTIN_DEFAULTS.reviewDraft;
    return {
      id: 'reviewDraft',
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      desc: 'Your peer evaluator is drafting your observation. You can view and comment now.',
      monthLabel: lastMod ? monthLabel(lastMod) : '',
      dateLabel: lastMod ? `Updated ${dateLabel(lastMod)}` : 'In progress',
      dueRelative: '',
      cta: labels.cta,
      ctaUrl: `/observations/${obs.observationId}`,
      status: 'soon',
      completedLabel: null,
      percent: null,
      percentLabel: '',
    };
  },

  postObs: (ctx) => {
    const finalized = ctx.finalizedStandard[0] ?? null;
    const draft = ctx.standardDraft;
    const obs = finalized ?? draft;
    if (!obs) return null;
    const postDate = toDate(obs.postObsDate);
    const labels = BUILTIN_DEFAULTS.postObs;
    const isFinal = finalized != null;
    return {
      id: 'postObs',
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      desc: '30 minutes to talk through proficiency ratings and where to focus next.',
      monthLabel: postDate ? monthLabel(postDate) : '',
      dateLabel: postDate ? dateLabel(postDate) : 'Awaiting date',
      dueRelative: '',
      cta: labels.cta,
      ctaUrl: `/observations/${obs.observationId}`,
      status: isFinal && postDate ? 'done' : postDate ? 'soon' : 'upcoming',
      completedLabel: isFinal && postDate ? dateLabel(postDate) : null,
      percent: null,
      percentLabel: '',
    };
  },

  acknowledge: (ctx) => {
    const obs = ctx.finalizedStandard[0];
    if (!obs) return null;
    const finalized = toDate(obs.finalizedAt);
    if (!finalized) return null;
    const acked = toDate(obs.acknowledgedAt);
    const labels = BUILTIN_DEFAULTS.acknowledge;
    return {
      id: 'acknowledge',
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      desc: 'Acknowledging stores your sign-off on the finalized observation record.',
      monthLabel: monthLabel(finalized),
      dateLabel: dateLabel(finalized),
      dueRelative: acked ? '' : 'Action required',
      cta: labels.cta,
      ctaUrl: '',
      status: acked ? 'done' : 'soon',
      completedLabel: acked ? dateLabel(acked) : null,
      percent: null,
      percentLabel: '',
      ackObservationId: obs.observationId,
    };
  },

  workProduct: (ctx) => {
    if (!ctx.hasWorkProduct) return null;
    const labels = BUILTIN_DEFAULTS.workProduct;
    const draft = ctx.workProductDraft;
    const finalized = ctx.finalizedWorkProduct;
    const obs = draft ?? finalized;
    if (!obs) return null;
    const target = ctx.workProductQuestionsCount;
    const answered = obs.workProductAnswers?.filter((a) => a.answer.trim() !== '').length ?? 0;
    const percent = target > 0 ? Math.min(100, Math.round((answered / target) * 100)) : 0;
    const isFinalized = obs.status === OBSERVATION_STATUS.finalized;
    const created = toDate(obs.lastModifiedAt) ?? toDate(obs.createdAt);
    return {
      id: 'workProduct',
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      desc: 'Short prompts about your planning, family communication, and growth. Save and resume any time.',
      monthLabel: created ? monthLabel(created) : '',
      dateLabel: isFinalized && created ? dateLabel(created) : 'In progress',
      dueRelative: '',
      cta: isFinalized ? 'View' : labels.cta,
      ctaUrl: '/my-rubric',
      status: isFinalized ? 'done' : answered > 0 ? 'inprogress' : 'soon',
      completedLabel: isFinalized && created ? dateLabel(created) : null,
      percent: isFinalized ? null : percent,
      percentLabel: target > 0 ? `${String(answered)} of ${String(target)} answered` : '',
    };
  },

  instructionalRound: (ctx) => {
    if (!ctx.hasInstructionalRound) return null;
    const labels = BUILTIN_DEFAULTS.instructionalRound;
    const draft = ctx.instructionalRoundDraft;
    const finalized = ctx.finalizedInstructionalRound;
    const obs = draft ?? finalized;
    if (!obs) return null;
    const target = ctx.instructionalRoundQuestionsCount;
    const answered = obs.workProductAnswers?.filter((a) => a.answer.trim() !== '').length ?? 0;
    const percent = target > 0 ? Math.min(100, Math.round((answered / target) * 100)) : 0;
    const isFinalized = obs.status === OBSERVATION_STATUS.finalized;
    const created = toDate(obs.lastModifiedAt) ?? toDate(obs.createdAt);
    return {
      id: 'instructionalRound',
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      desc: 'Reflective responses for this instructional round.',
      monthLabel: created ? monthLabel(created) : '',
      dateLabel: isFinalized && created ? dateLabel(created) : 'In progress',
      dueRelative: '',
      cta: isFinalized ? 'View' : labels.cta,
      ctaUrl: '/my-rubric',
      status: isFinalized ? 'done' : answered > 0 ? 'inprogress' : 'soon',
      completedLabel: isFinalized && created ? dateLabel(created) : null,
      percent: isFinalized ? null : percent,
      percentLabel: target > 0 ? `${String(answered)} of ${String(target)} answered` : '',
    };
  },
};

// ─── Public entry point ──────────────────────────────────────────────────────

export function deriveCheckpoints(
  cfg: DashboardCheckpointsConfig,
  ctx: DeriveContext,
): CheckpointWithStatus[] {
  // Filter enabled, build in admin-specified order, apply label overrides.
  const entries: {
    key: CheckpointTypeKey;
    order: number;
    cfg: DashboardCheckpointConfig | undefined;
  }[] = CHECKPOINT_TYPE_KEYS.map((key) => {
    const typeCfg = cfg[key];
    const enabled = typeCfg?.enabled ?? true;
    return {
      key,
      order: typeCfg?.order ?? BUILTIN_DEFAULTS[key].defaultOrder,
      cfg: typeCfg,
      enabled,
    };
  })
    .filter((e) => e.enabled)
    .sort((a, b) => a.order - b.order);

  const out: CheckpointWithStatus[] = [];
  for (const { key, cfg: typeCfg } of entries) {
    const built = BUILDERS[key](ctx);
    if (!built) continue;
    const labels = resolveLabels(key, typeCfg);
    out.push({
      ...built,
      key,
      type: labels.type,
      typeLabel: labels.typeLabel,
      title: labels.title,
      cta: labels.cta,
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
