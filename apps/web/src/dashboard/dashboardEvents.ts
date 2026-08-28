import {
  OBSERVATION_STATUS,
  workProductAnswerHasText,
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
  /** The open self-scheduling window this staff member is invited to but
   *  hasn't booked yet. `windowEndDate` (booking deadline) is threaded
   *  through here rather than a separate global lookup. */
  openBooking: { windowId: string; token: string; endDate: Date | null } | null;
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

/** Pick the observation a step tracks. */
export function resolveObservation(ctx: DeriveContext, kind: WatchedKind): Observation | null {
  switch (kind) {
    case 'standard':
      // Draft first: the meeting/date steps must track the LIVE cycle. A
      // prior cycle's finalized observation would otherwise shadow the new
      // draft forever — its preObs/observation/postObs dates are frozen (or
      // null), so those cards could never show or complete again.
      return ctx.standardDraft ?? ctx.finalizedStandard[0] ?? null;
    case 'standardFinalized':
      return ctx.finalizedStandard[0] ?? null;
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

/**
 * The observation's date, but only when it was genuinely scheduled.
 * `observationDate` is schema-required, and CreateObservationDialog fills it
 * with `new Date()` at record creation — the same clock instant as
 * `createdAt`. That placeholder is not a scheduled visit, and treating it as
 * one made the "Classroom observation" card appear (and instantly complete)
 * the moment a draft was created. A real schedule signal is either a booked
 * slot (`scheduledStartAt`) or an evaluator-edited date, which the editor's
 * date input writes as a date-only value that no longer matches `createdAt`.
 */
const CREATION_DEFAULT_EPSILON_MS = 60_000;
function scheduledObservationDate(obs: Observation | null): Date | null {
  const d = toDate(obs?.observationDate);
  if (!d) return null;
  if (obs?.scheduledStartAt != null) return d;
  const created = toDate(obs?.createdAt);
  if (created && Math.abs(d.getTime() - created.getTime()) < CREATION_DEFAULT_EPSILON_MS) {
    return null;
  }
  return d;
}

type Evaluator = (ctx: DeriveContext, obs: Observation | null, now: Date) => EventResult;

export const EVENT_EVALUATORS: Record<BooleanEvent, Evaluator> = {
  observationCreated: (_ctx, obs) => ({
    satisfied: obs != null,
    date: obs ? toDate(obs.createdAt) : null,
  }),
  signupWindowOpened: (ctx) => ({ satisfied: ctx.openBooking != null, date: null }),
  signupSlotBooked: (ctx) => ({ satisfied: ctx.hasBookedSlot, date: null }),
  preObsDateSet: (_ctx, obs, now) => dateSetResult(toDate(obs?.preObsDate), now, false),
  preObsDatePassed: (_ctx, obs, now) => dateSetResult(toDate(obs?.preObsDate), now, true),
  observationDateSet: (_ctx, obs, now) => dateSetResult(scheduledObservationDate(obs), now, false),
  observationDatePassed: (_ctx, obs, now) =>
    dateSetResult(scheduledObservationDate(obs), now, true),
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

export const DATE_SOURCE_FN: Record<
  DateSource,
  (obs: Observation | null, ctx: DeriveContext) => Date | null
> = {
  none: () => null,
  preObsDate: (obs) => toDate(obs?.preObsDate),
  observationDate: (obs) => scheduledObservationDate(obs),
  postObsDate: (obs) => toDate(obs?.postObsDate),
  finalizedAt: (obs) => toDate(obs?.finalizedAt),
  createdAt: (obs) => toDate(obs?.createdAt),
  lastModifiedAt: (obs) => toDate(obs?.lastModifiedAt),
  windowEndDate: (_obs, ctx) => ctx.openBooking?.endDate ?? null,
};

/** answered / total for the in-progress bar, keyed by the watched kind. */
export function responseProgress(
  ctx: DeriveContext,
  obs: Observation | null,
  kind: WatchedKind,
): { answered: number; total: number } {
  const answered =
    obs?.workProductAnswers?.filter((a) => workProductAnswerHasText(a.answer)).length ?? 0;
  const total =
    kind === 'instructionalRound'
      ? ctx.instructionalRoundQuestionsCount
      : ctx.workProductQuestionsCount;
  return { answered, total };
}
