import type { StaffYear } from '@ops/shared';
import { CYCLE_STATUSES, type CycleStatus, cycleStatus, displayYear } from '@ops/shared';

// Cycle status/year logic now lives in @ops/shared; re-exported here so existing
// web imports keep working. Labels + the table-pill encoding stay web-local.
export { CYCLE_STATUSES, cycleStatus, displayYear };
export type { CycleStatus };

const LABELS: Record<CycleStatus, string> = {
  planning: 'Planning',
  developing: 'Developing',
  high: 'High Cycle',
  probationary: 'Probationary',
};

export function cycleStatusLabel(status: CycleStatus): string {
  return LABELS[status];
}

/**
 * Encode a chosen display-year (1-3) + status back into stored fields.
 *
 * Planning and Developing are *defined* by the year (1, and 2-3
 * respectively), so choosing one of them moves the year to match — picking
 * "Planning" for a year-2 staff member makes them year 1, because a Planning
 * year 2 does not exist. Probationary and High Cycle leave the year alone;
 * both are legal at any point in the loop.
 */
export function encodeYearStatus(
  year: 1 | 2 | 3,
  status: CycleStatus,
): { year: StaffYear; summativeYear: boolean } {
  if (status === 'probationary') return { year: (year + 3) as StaffYear, summativeYear: true };
  if (status === 'high') return { year, summativeYear: true };
  if (status === 'planning') return { year: 1, summativeYear: false };
  return { year: year === 1 ? 2 : year, summativeYear: false };
}

/**
 * Set the display-year without touching the phase inputs — the counterpart to
 * `encodeYearStatus` for the Year control. Routing a year change back through
 * the status would snap Planning to year 1 the instant the user picked year 2,
 * making the Year select look broken; the phase re-derives from the new year
 * instead.
 */
export function encodeYear(
  year: 1 | 2 | 3,
  current: { year: number; summativeYear: boolean },
): { year: StaffYear; summativeYear: boolean } {
  const probationary = current.year >= 4;
  return {
    year: (probationary ? year + 3 : year) as StaffYear,
    summativeYear: current.summativeYear,
  };
}
