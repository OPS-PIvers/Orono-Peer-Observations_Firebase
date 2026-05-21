import type { StaffYear } from '@ops/shared';

export const CYCLE_STATUSES = ['low', 'high', 'probationary'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

const LABELS: Record<CycleStatus, string> = {
  low: 'Low Cycle',
  high: 'High Cycle',
  probationary: 'Probationary',
};

export function cycleStatusLabel(status: CycleStatus): string {
  return LABELS[status];
}

/** Stored years 1-3 are continuing; 4-6 are probationary P1-P3. Both display as 1-3. */
export function displayYear(year: number): 1 | 2 | 3 {
  const d = year >= 4 ? year - 3 : year;
  return (d < 1 ? 1 : d > 3 ? 3 : d) as 1 | 2 | 3;
}

export function cycleStatus(year: number, summativeYear: boolean): CycleStatus {
  if (year >= 4) return 'probationary';
  return summativeYear ? 'high' : 'low';
}

/** Encode a chosen display-year (1-3) + status back into stored fields. */
export function encodeYearStatus(
  year: 1 | 2 | 3,
  status: CycleStatus,
): { year: StaffYear; summativeYear: boolean } {
  if (status === 'probationary') return { year: (year + 3) as StaffYear, summativeYear: true };
  return { year, summativeYear: status === 'high' };
}
