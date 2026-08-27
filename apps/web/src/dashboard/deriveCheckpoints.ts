import {
  type DashboardStep,
  type DateSource,
  type DoneWhen,
  type Observation,
  type ShowWhen,
} from '@ops/shared';
import { type IcsEventInput } from '@/lib/ics';
import {
  DATE_SOURCE_FN,
  EVENT_EVALUATORS,
  resolveObservation,
  responseProgress,
  toDate,
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
  /** The concrete Date backing `dateLabel`/`monthLabel`, or null when the
   *  card has no concrete date yet (see `fallbackDateLabel`). Kept alongside
   *  the formatted labels so consumers that need the real Date — e.g. the
   *  "Add to calendar" .ics download (STAFF-04) — don't have to re-parse a
   *  human-readable string. */
  rawDate: Date | null;
  /** The step's configured `dateFrom` — kept alongside `rawDate` so
   *  consumers can tell a genuinely scheduled event date (preObsDate /
   *  observationDate / postObsDate) apart from a deadline (windowEndDate)
   *  or record metadata (createdAt / lastModifiedAt / finalizedAt) that
   *  happens to resolve to a Date but isn't an event to put on a calendar.
   *  See `checkpointToIcsEvent`. */
  dateSource: DateSource;
  /** The observation's real booked-slot start/end (`scheduledStartAt` /
   *  `scheduledEndAt`), threaded through only for the `observationDate`
   *  dateSource. Non-null `scheduledStartAt` is the sole signal that
   *  `rawDate` reflects an actual booked meeting time rather than e.g. a
   *  record-creation timestamp that happens to carry a time-of-day (see
   *  `checkpointToIcsEvent` — a bare Date's time-of-day is NOT a reliable
   *  signal, since `new Date()` at draft-creation time almost never lands
   *  on exact local midnight either). Null for every other checkpoint. */
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  dueRelative: string;
  cta: string;
  ctaUrl: string;
  status: CheckpointStatus;
  /** True when the card's date represents a closing deadline within a
   *  few days (e.g. an open booking window about to expire). Drives
   *  urgency styling distinct from `status`. */
  urgent: boolean;
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

/**
 * The observation's document id. `observationId` is required by the schema,
 * but Firestore reads bypass Zod and a handful of production docs were
 * written without it — those produced a `/observations/undefined` link and an
 * Acknowledge that wrote to an undefined doc id. `hydrateFirestoreDoc`
 * always attaches the real doc `id`, so fall back to that.
 */
function observationDocId(obs: Observation): string {
  const withId = obs as Observation & { id?: string };
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod; the type says observationId is required but stored docs may omit it
  return withId.observationId ?? withId.id ?? '';
}

function resolveButton(
  step: DashboardStep,
  ctx: DeriveContext,
  obs: Observation | null,
): { ctaUrl: string; ackObservationId?: string } {
  switch (step.buttonTarget) {
    case 'observation': {
      const id = obs ? observationDocId(obs) : '';
      return { ctaUrl: id ? `/observations/${id}` : '' };
    }
    case 'booking': {
      const booking = ctx.openBooking
        ? `/book/${ctx.openBooking.windowId}?token=${ctx.openBooking.token}`
        : '';
      return { ctaUrl: booking || (ctx.appSettings?.signupLink ?? '') };
    }
    case 'acknowledge': {
      const id = obs ? observationDocId(obs) : '';
      return id ? { ctaUrl: '', ackObservationId: id } : { ctaUrl: '' };
    }
    case 'fixedUrl':
      return { ctaUrl: step.buttonUrl };
    case 'none':
    default:
      return { ctaUrl: '' };
  }
}

/** Contextual placeholder shown when a step has no concrete date to display,
 *  mirroring the old per-type builders ("Awaiting date" / "In progress"). */
function fallbackDateLabel(status: CheckpointStatus): string {
  if (status === 'inprogress') return 'In progress';
  if (status === 'soon' || status === 'upcoming') return 'Awaiting date';
  return '';
}

/** Days remaining until `d` at local midnight granularity (0 = closes today,
 *  negative = already past — shouldn't normally happen since expired windows
 *  drop out of `openBooking` upstream, but handled defensively). */
function daysUntil(d: Date, now: Date): number {
  return Math.ceil((d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

/** Window closes within this many days -> urgency styling on the card. */
const DEADLINE_URGENCY_DAYS = 3;

function deadlineRelativeLabel(days: number): string {
  if (days <= 0) return 'Closes today';
  if (days === 1) return 'Closes tomorrow';
  return `${String(days)} days left`;
}

export function deriveCheckpoints(
  steps: DashboardStep[],
  ctx: DeriveContext,
  now: Date = new Date(),
): CheckpointWithStatus[] {
  const ordered = steps
    .filter((s) => s.enabled)
    .slice()
    .sort((a, b) => a.order - b.order);
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

    const stepDate = DATE_SOURCE_FN[step.dateFrom](obs, ctx);
    // Only the observationDate step can ever back onto a real booked slot
    // (bookObservationSlot writes observationDate = scheduledStartAt). Every
    // other dateFrom — including a manually-created observation's
    // record-creation `observationDate` — has no booked-slot backing, so
    // leave these null rather than reading fields that don't apply.
    const scheduledStartAt =
      step.dateFrom === 'observationDate' ? toDate(obs?.scheduledStartAt) : null;
    const scheduledEndAt = step.dateFrom === 'observationDate' ? toDate(obs?.scheduledEndAt) : null;
    const { ctaUrl, ackObservationId } = resolveButton(step, ctx, obs);
    const isAck = step.buttonTarget === 'acknowledge';
    const isDeadline = step.dateFrom === 'windowEndDate';

    let cardDateLabel = stepDate ? dateLabel(stepDate) : fallbackDateLabel(status);
    let dueRelative = isAck && !done ? 'Action required' : '';
    let urgent = false;
    if (isDeadline && stepDate && !done) {
      const days = daysUntil(stepDate, now);
      urgent = days <= DEADLINE_URGENCY_DAYS;
      cardDateLabel = `Closes ${dateLabel(stepDate)}`;
      dueRelative = deadlineRelativeLabel(days);
    }

    out.push({
      id: step.id,
      key: step.id,
      type: step.chipStyle,
      typeLabel: step.chipLabel,
      title: step.title,
      desc: step.description,
      monthLabel: stepDate ? monthLabel(stepDate) : '',
      dateLabel: cardDateLabel,
      rawDate: stepDate,
      dateSource: step.dateFrom,
      scheduledStartAt,
      scheduledEndAt,
      dueRelative,
      cta: step.buttonLabel,
      ctaUrl,
      status,
      urgent,
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

/**
 * Date sources that represent a genuinely scheduled event with a concrete
 * date the staff member would want on their calendar. Deliberately a
 * whitelist, not keyed on the card's visual `chipStyle` — chip color is an
 * admin display choice, not a signal about what the date means. Excluded by
 * omission: `windowEndDate` (a booking *deadline*, already relabeled
 * "Closes {date}" by the `isDeadline` handling above) and `createdAt` /
 * `lastModifiedAt` / `finalizedAt` (Firestore record metadata that happens
 * to be a Date but was never a scheduled event).
 */
const ICS_ELIGIBLE_DATE_SOURCES: ReadonlySet<DateSource> = new Set([
  'preObsDate',
  'observationDate',
  'postObsDate',
]);

/** Fallback event duration for the narrow case where a real booked slot's
 *  `scheduledStartAt` is known but its `scheduledEndAt` is missing. Every
 *  write site that sets `scheduledStartAt` (bookObservationSlot,
 *  rescheduleBooking) sets `scheduledEndAt` in the same write, so this
 *  should be unreachable in practice — kept only as a defensive fallback
 *  rather than surfacing a start-only event with no visible end. */
export const DEFAULT_ICS_EVENT_DURATION_MINUTES = 45;

/** `YYYYMMDD` for a Date's LOCAL calendar date — used to key the .ics UID. */
function dateStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * Build the `.ics` event input for a checkpoint card's "Add to calendar"
 * link (STAFF-04), or `null` when the checkpoint isn't a genuinely
 * scheduled event, has no concrete date yet, or has no title to put in the
 * calendar entry. Pure — the caller turns this into a downloadable file via
 * `buildIcsEvent`/`downloadTextFile`.
 *
 * Eligibility is keyed on `task.dateSource` (the step's `dateFrom`), not on
 * `task.type` — see `ICS_ELIGIBLE_DATE_SOURCES`.
 *
 * Whether the event is emitted as timed or all-day is decided ONLY by
 * `task.scheduledStartAt` (a real booked slot's `scheduledStartAt`,
 * threaded through by `deriveCheckpoints` — see `CheckpointWithStatus`),
 * never by inspecting `rawDate`'s time-of-day. A bare Date's time-of-day is
 * not a trustworthy signal: e.g. a brand-new manually-created observation's
 * `observationDate` is set client-side to `new Date()` at record-creation
 * time (see CreateObservationDialog), which is a real clock instant but has
 * no relationship whatsoever to any actual meeting — treating that as
 * "timed" would fabricate a fake appointment on the staff member's
 * calendar. So: a real booked slot (`scheduledStartAt` present) always
 * produces a timed event ending at the true `scheduledEndAt` (falling back
 * to `DEFAULT_ICS_EVENT_DURATION_MINUTES` only if `scheduledEndAt` is
 * somehow missing); everything else — including an as-yet-unscheduled
 * `observationDate` — produces an all-day event on `rawDate`'s calendar
 * day, exactly as if it had come from a plain `<input type="date">`.
 *
 * `staffEmail` gives the UID entropy scoped to the observed staff member —
 * without it, two different staff members with the same checkpoint type on
 * the same date would produce byte-identical UIDs (the step id + date are
 * both drawn from the shared admin step template), which RFC 5545 3.8.4.7
 * forbids and which calendar clients treat as one event overwriting the
 * other on import into any shared calendar.
 */
export function checkpointToIcsEvent(
  task: CheckpointWithStatus,
  staffEmail: string,
): IcsEventInput | null {
  if (!ICS_ELIGIBLE_DATE_SOURCES.has(task.dateSource) || !task.rawDate || !task.title.trim()) {
    return null;
  }
  const scheduledStartAt = task.scheduledStartAt;
  const timed = scheduledStartAt != null;
  const start = timed ? scheduledStartAt : task.rawDate;
  const end = timed
    ? (task.scheduledEndAt ??
      new Date(scheduledStartAt.getTime() + DEFAULT_ICS_EVENT_DURATION_MINUTES * 60_000))
    : task.rawDate;
  return {
    uid: `${staffEmail}-${task.key}-${dateStamp(task.rawDate)}@peerobservations.orono.k12.mn.us`,
    summary: task.title,
    ...(task.desc ? { description: task.desc } : {}),
    start,
    end,
    allDay: !timed,
  };
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
