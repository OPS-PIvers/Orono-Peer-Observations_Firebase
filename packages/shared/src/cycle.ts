/**
 * Cycle state — pure domain logic shared by the web client, schemas, and
 * (mirrored, by hand) the Firestore security rules.
 *
 * Year encoding (mirrors GAS Constants.js): 1-3 = continuing-contract years;
 * 4-6 = probationary P1-P3, which display as 1-3.
 */

export const CYCLE_STATUSES = ['low', 'high', 'probationary'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/** Stored years 1-3 are continuing; 4-6 are probationary P1-P3. Both display as 1-3. */
export function displayYear(year: number): 1 | 2 | 3 {
  const d = year >= 4 ? year - 3 : year;
  return (d < 1 ? 1 : d > 3 ? 3 : d) as 1 | 2 | 3;
}

export function cycleStatus(year: number, summativeYear: boolean): CycleStatus {
  if (year >= 4) return 'probationary';
  return summativeYear ? 'high' : 'low';
}

/**
 * Inclusive start of the school year containing `now` — Aug 1, local time.
 * July and earlier belong to the prior year's cycle; August begins the new
 * one. Mirrors the dashboard's "2025 — 2026" school-year label, so queries
 * scoped with this boundary agree with what the hero eyebrow claims.
 */
export function schoolYearStart(now: Date = new Date()): Date {
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(startYear, 7, 1);
}
