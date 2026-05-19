import type {
  DashboardCheckpoint,
  DashboardCheckpointProgress,
  DashboardProgress,
} from '@ops/shared';

/** Status derived per-checkpoint at render time. */
export type CheckpointStatus = 'done' | 'inprogress' | 'soon' | 'upcoming';

export interface CheckpointWithStatus extends DashboardCheckpoint {
  status: CheckpointStatus;
  /** Absolute date label for the "Completed" column when status is 'done'. */
  completedLabel: string | null;
  /** Relative phrase under the date for active checkpoints, e.g. "In 6 days". */
  dueRelative: string;
  percent: number | null;
  percentLabel: string;
}

const MS_PER_DAY = 86_400_000;

function daysUntil(date: Date, today: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / MS_PER_DAY);
}

function relativePhrase(days: number): string {
  if (days < 0) return `${String(Math.abs(days))} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days <= 14) return `In ${String(days)} days`;
  if (days <= 30) return `In ${String(Math.round(days / 7))} weeks`;
  return '';
}

function formatCompletedLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Decorate each checkpoint with status, due-relative text, and any in-progress
 * percent. The first non-done checkpoint with a due date in the next 14 days
 * (or already overdue) is marked `soon` — a single highlighted "next up". If
 * the staff member has actively saved progress (percent ≥ 1), it overrides to
 * `inprogress` for that checkpoint regardless of date.
 */
export function decorateCheckpoints(
  checkpoints: DashboardCheckpoint[],
  progress: DashboardProgress | null,
  today: Date = new Date(),
): CheckpointWithStatus[] {
  let nextActiveAssigned = false;

  return checkpoints.map((c) => {
    const entry: DashboardCheckpointProgress | null = progress?.checkpoints[c.id] ?? null;

    // Done short-circuit
    if (entry?.completedAt) {
      const completed = toDate(entry.completedAt);
      return {
        ...c,
        status: 'done',
        completedLabel: completed ? formatCompletedLabel(completed) : c.dateLabel,
        dueRelative: '',
        percent: null,
        percentLabel: '',
      };
    }

    // In-progress (explicit percent saved by the staff member or a PE)
    if (entry?.percent != null && entry.percent > 0 && entry.percent < 100) {
      nextActiveAssigned = true;
      return {
        ...c,
        status: 'inprogress',
        completedLabel: null,
        dueRelative: relativeFromDueDate(c.dueDate, today),
        percent: entry.percent,
        percentLabel: entry.percentLabel,
      };
    }

    // Date-driven: first not-yet-done checkpoint within 14 days (or past
    // due) becomes the single "soon" highlight. Anything after that stays
    // upcoming so we don't double-feature.
    const due = toDate(c.dueDate);
    if (!nextActiveAssigned && due) {
      const days = daysUntil(due, today);
      if (days <= 14) {
        nextActiveAssigned = true;
        return {
          ...c,
          status: 'soon',
          completedLabel: null,
          dueRelative: relativePhrase(days),
          percent: null,
          percentLabel: '',
        };
      }
    }

    return {
      ...c,
      status: 'upcoming',
      completedLabel: null,
      dueRelative: due ? relativePhrase(daysUntil(due, today)) : '',
      percent: null,
      percentLabel: '',
    };
  });
}

function relativeFromDueDate(dueDate: Date | null, today: Date): string {
  const d = toDate(dueDate);
  if (!d) return '';
  return relativePhrase(daysUntil(d, today));
}

function toDate(value: Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  // Firestore timestamps serialize to objects with `.toDate()`. Some legacy
  // imports may also store ISO strings. Handle both defensively.
  const maybe = value as unknown as { toDate?: () => Date };
  if (typeof maybe.toDate === 'function') return maybe.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Continuing tier covers years 1–3, probationary covers 4–6 (P1–P3). */
export function tierForYear(year: number): 'continuing' | 'probationary' {
  return year >= 4 ? 'probationary' : 'continuing';
}

/** Two-letter initials from a display name; falls back to the first
 *  alphanumeric character of the email. */
export function initialsFromName(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] ?? '').toUpperCase() + (parts[1][0] ?? '').toUpperCase();
  }
  if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase();
  return (email[0] ?? '?').toUpperCase();
}
