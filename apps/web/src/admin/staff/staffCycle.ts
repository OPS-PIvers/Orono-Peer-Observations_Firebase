import type { StaffYear } from '@ops/shared';
import { CYCLE_STATUSES, type CycleStatus, cycleStatus, displayYear } from '@ops/shared';

// Cycle status/year logic now lives in @ops/shared; re-exported here so existing
// web imports keep working. Labels + the table-pill encoding stay web-local.
export { CYCLE_STATUSES, cycleStatus, displayYear };
export type { CycleStatus };

const LABELS: Record<CycleStatus, string> = {
  low: 'Low Cycle',
  high: 'High Cycle',
  probationary: 'Probationary',
};

export function cycleStatusLabel(status: CycleStatus): string {
  return LABELS[status];
}

/** Encode a chosen display-year (1-3) + status back into stored fields. */
export function encodeYearStatus(
  year: 1 | 2 | 3,
  status: CycleStatus,
): { year: StaffYear; summativeYear: boolean } {
  if (status === 'probationary') return { year: (year + 3) as StaffYear, summativeYear: true };
  return { year, summativeYear: status === 'high' };
}
