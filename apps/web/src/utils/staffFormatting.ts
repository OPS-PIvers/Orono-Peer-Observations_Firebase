import type { CycleStatus } from '@ops/shared';

export function yearLabel(year: number): string {
  return year < 4 ? `Y${String(year)}` : `P${String(year - 3)}`;
}

export function yearBadgeClass(year: number): string {
  return year < 4
    ? 'bg-gray-100 text-gray-700 border border-gray-200'
    : 'bg-ops-red-lighter text-ops-red-dark border border-ops-red-lighter';
}

const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = {
  planning: 'Planning',
  developing: 'Developing',
  high: 'High Cycle',
  probationary: 'Probationary',
};

export function cycleStatusLabel(status: CycleStatus): string {
  return CYCLE_STATUS_LABELS[status];
}

/**
 * Human-readable year + cycle status. Year and status are independent, so
 * both always show — except a Probationary status on a P-year, where the
 * suffix would just repeat the year. Example outputs:
 *   "Tenured Year 2 — High Cycle"
 *   "Tenured Year 1 — Planning"
 *   "Probationary 1"
 *   "Probationary 2 — Developing"
 */
export function yearStatusLabel(year: number, status: CycleStatus): string {
  const base = year < 4 ? `Tenured Year ${String(year)}` : `Probationary ${String(year - 3)}`;
  return year >= 4 && status === 'probationary' ? base : `${base} — ${cycleStatusLabel(status)}`;
}

/**
 * School-year bucket for an observation date. Boundary is July 1 (the
 * legal annual changeover for Minnesota public schools), so an obs on
 * 2025-10-15 lands in "2025–2026"; one on 2025-06-30 lands in "2024–2025".
 */
export function schoolYearOf(date: Date): string {
  const year = date.getFullYear();
  const isSecondHalf = date.getMonth() >= 6; // 0=Jan, 6=Jul
  const start = isSecondHalf ? year : year - 1;
  return `${String(start)}–${String(start + 1)}`;
}

/**
 * Coerce a Firestore date-ish value into a JS Date. The shared schemas
 * type these as `z.date()` but `useFirestoreCollection` doesn't apply a
 * converter, so values arrive as Firestore Timestamps (with `.toDate()`)
 * or, in older docs, ISO strings. Returns null for unrecognised input.
 */
export function toJsDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}
