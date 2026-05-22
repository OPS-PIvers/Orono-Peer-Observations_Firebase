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
