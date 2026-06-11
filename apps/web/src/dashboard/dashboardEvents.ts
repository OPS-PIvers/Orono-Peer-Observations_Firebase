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

/** Observation as the dashboard hooks deliver it — the Firestore snapshot doc
 *  id is attached on read. Legacy manually created docs were written without
 *  the denormalized `observationId` field, so consumers that build CTA links
 *  fall back to this doc id (the two are identical when both exist). */
export type DashboardObservation = Observation & { id?: string };

/** Context passed to the interpreter — every observation + scheduling signal
 *  the dashboard already loads. Lives here so the registry and interpreter
 *  share one definition (deriveCheckpoints re-exports it). */
export interface DeriveContext {
  finalizedStandard: DashboardObservation[];
  standardDraft: DashboardObservation | null;
  workProductDraft: DashboardObservation | null;
  instructionalRoundDraft: DashboardObservation | null;
  finalizedWorkProduct: DashboardObservation | null;
  finalizedInstructionalRound: DashboardObservation | null;
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

/** Standard-kind resolution: the finalized observation wins UNLESS an active
 *  draft was created after it was finalized. Staff observed more than once a
 *  year (e.g. probationary) get a second draft mid-year — the step sequence
 *  must restart and track that new cycle instead of staying pinned to the
 *  first finalized observation. */
function resolveStandard(ctx: DeriveContext): DashboardObservation | null {
  const finalized = ctx.finalizedStandard[0] ?? null;
  const draft = ctx.standardDraft;
  if (!finalized) return draft;
  if (!draft) return finalized;
  const draftCreatedAt = toDate(draft.createdAt);
  const finalizedAt = toDate(finalized.finalizedAt);
  if (draftCreatedAt && finalizedAt && draftCreatedAt.getTime() > finalizedAt.getTime()) {
    return draft;
  }
  return finalized;
}

/** Pick the observation a step tracks: finalized first, else draft — except
 *  for the standard kind, where a draft newer than the finalized observation
 *  restarts the cycle (see resolveStandard). */
export function resolveObservation(
  ctx: DeriveContext,
  kind: WatchedKind,
): DashboardObservation | null {
  switch (kind) {
    case 'standard':
      return resolveStandard(ctx);
    case 'workProduct':
      return ctx.finalizedWorkProduct ?? ctx.workProductDraft ?? null;
    case 'instructionalRound':
      return ctx.finalizedInstructionalRound ?? ctx.instructionalRoundDraft ?? null;
    case 'any':
      return (
        resolveStandard(ctx) ??
        ctx.workProductDraft ??
        ctx.instructionalRoundDraft ??
        ctx.finalizedWorkProduct ??
        ctx.finalizedInstructionalRound ??
        null
      );
    case 'anyDraft':
      // Never falls through to a finalized observation — used by reviewDraft
      // so a new draft surfaces even when a prior cycle's obs is finalized.
      return ctx.standardDraft ?? ctx.workProductDraft ?? ctx.instructionalRoundDraft ?? null;
  }
}

function dateSetResult(d: Date | null, now: Date, mustBePast: boolean): EventResult {
  if (!d) return { satisfied: false, date: null };
  return { satisfied: mustBePast ? d.getTime() < now.getTime() : true, date: d };
}

type Evaluator = (ctx: DeriveContext, obs: Observation | null, now: Date) => EventResult;

export const EVENT_EVALUATORS: Record<BooleanEvent, Evaluator> = {
  observationCreated: (_ctx, obs) => ({
    satisfied: obs != null,
    date: obs ? toDate(obs.createdAt) : null,
  }),
  signupWindowOpened: (ctx) => ({ satisfied: ctx.openBooking != null, date: null }),
  signupSlotBooked: (_ctx, obs) => ({ satisfied: obs?.slotId != null, date: null }),
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
