/**
 * Cycle state — pure domain logic shared by the web client, schemas, and
 * (mirrored, by hand) the Firestore security rules.
 *
 * Year encoding (mirrors GAS Constants.js): 1-3 = continuing-contract years;
 * 4-6 = probationary P1-P3, which display as 1-3.
 */

import type { StaffYear } from './schema/staff.js';

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
 * Annual rollover — where a staff member's stored year lands after one
 * school year passes:
 *
 *   Continuing (tenured) 3-year loop:  1 → 2 → 3 → 1
 *   Probationary track:                4 (P1) → 5 (P2) → 6 (P3) → 1
 *
 * Completing P3 (stored year 6) earns a continuing contract, so the next
 * position is continuing year 1 — the tenure transition.
 */
export function nextCycleYear(year: StaffYear): StaffYear {
  if (year === 3 || year === 6) return 1;
  return (year + 1) as StaffYear;
}

/** True when advancing from `year` crosses the probationary → tenured
 *  boundary (finished P3, earns a continuing contract). */
export function isTenureTransition(year: StaffYear): boolean {
  return year === 6;
}

export interface CycleRollover {
  year: StaffYear;
  summativeYear: boolean;
}

/**
 * Default year + summativeYear for a staff member after an annual rollover.
 *
 * `summativeYear` derivation for the NEW position:
 *   - still probationary (4-6): true — probationary staff are summatively
 *     evaluated every year (mirrors encodeYearStatus in the web client)
 *   - continuing year 3: true — the summative-review (high-cycle) year that
 *     closes out the 3-year continuing loop
 *   - continuing years 1-2 (including fresh tenure at year 1): false
 *
 * This is a *default*: admins can override summativeYear per person in the
 * rollover preview before anything is written.
 */
export function rolloverCycle(year: StaffYear): CycleRollover {
  const next = nextCycleYear(year);
  return { year: next, summativeYear: next >= 4 || next === 3 };
}
