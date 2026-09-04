/**
 * Cycle state — pure domain logic shared by the web client, schemas, and
 * (mirrored, by hand) the Firestore security rules.
 *
 * Year encoding (mirrors GAS Constants.js): 1-3 = continuing-contract years;
 * 4-6 = probationary P1-P3, which display as 1-3.
 */

import type { StaffYear } from './schema/staff.js';

export const CYCLE_STATUSES = ['planning', 'developing', 'high', 'probationary'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/**
 * `'low'` was the single pre-2026 label for both non-summative continuing
 * years, before the peer-evaluator team split it into Planning (year 1) and
 * Developing (years 2-3). Stored `modules/{id}.autoEnable.value` documents
 * still carry it, so it stays *parseable* (see `moduleAutoEnableStatus`) even
 * though it is no longer offered anywhere in the UI. Nothing derives it.
 */
export const LEGACY_CYCLE_STATUS = 'low';

/** Every status a stored `autoEnable.value` may legally hold — the current
 *  four plus the deprecated alias above. */
export const STORED_CYCLE_STATUSES = [...CYCLE_STATUSES, LEGACY_CYCLE_STATUS] as const;
export type StoredCycleStatus = (typeof STORED_CYCLE_STATUSES)[number];

/** Stored years 1-3 are continuing; 4-6 are probationary P1-P3. Both display as 1-3. */
export function displayYear(year: number): 1 | 2 | 3 {
  const d = year >= 4 ? year - 3 : year;
  return (d < 1 ? 1 : d > 3 ? 3 : d) as 1 | 2 | 3;
}

/**
 * The cycle phase a staff member is in, derived from the two stored fields.
 * Probationary and summative both outrank the year, so the year only decides
 * between the two non-summative continuing phases:
 *
 *   year >= 4                  Probationary  (P1-P3)
 *   summativeYear              High Cycle    (the year that closes the loop)
 *   year 1, non-summative      Planning
 *   years 2-3, non-summative   Developing
 *
 * Derived, never stored — renaming a phase is a pure display change and needs
 * no migration of /staff.
 */
export function cycleStatus(year: number, summativeYear: boolean): CycleStatus {
  if (year >= 4) return 'probationary';
  if (summativeYear) return 'high';
  return year === 1 ? 'planning' : 'developing';
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
