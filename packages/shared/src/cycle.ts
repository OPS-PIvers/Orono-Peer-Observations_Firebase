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
 * The *legacy* cycle phase, derived from the two fields every staff doc
 * carried before `cycleStatus` was stored. Probationary and summative both
 * outrank the year, so the year only decides between the two non-summative
 * continuing phases:
 *
 *   year >= 4                  Probationary  (P1-P3)
 *   summativeYear              High Cycle    (the year that closes the loop)
 *   year 1, non-summative      Planning
 *   years 2-3, non-summative   Developing
 *
 * Only the fallback for docs that predate the stored field — read status
 * through `staffCycleStatus`, never this directly. Mirrored by hand in
 * firestore.rules (`matchesModuleAutoEnable`).
 */
export function cycleStatus(year: number, summativeYear: boolean): CycleStatus {
  if (year >= 4) return 'probationary';
  if (summativeYear) return 'high';
  return year === 1 ? 'planning' : 'developing';
}

/**
 * The staff fields the status helpers read. `summativeYear` and
 * `cycleStatus` are optional because Firestore reads bypass the Zod schema —
 * a doc written before either field existed simply omits it.
 */
export interface CycleStatusStaff {
  year: number;
  summativeYear?: boolean | undefined;
  cycleStatus?: CycleStatus | null | undefined;
}

/**
 * A staff member's cycle status. Status and year are independent: year alone
 * decides assigned domains, status is its own admin-set label. The stored
 * `staff.cycleStatus` wins; docs written before it existed fall back to the
 * legacy derivation (`cycleStatus(year, summativeYear)`) until
 * `scripts/backfill/backfill-cycle-status.ts` stamps them.
 *
 * Every status consumer goes through here, and firestore.rules mirrors the
 * same stored-with-fallback read, so the two can never disagree.
 */
export function staffCycleStatus(staff: CycleStatusStaff): CycleStatus {
  const stored = staff.cycleStatus;
  if (stored && (CYCLE_STATUSES as readonly string[]).includes(stored)) return stored;
  return cycleStatus(staff.year, staff.summativeYear ?? false);
}

/** Summative follows status: High Cycle and Probationary staff receive a
 *  summative evaluation; Planning and Developing staff a formative one. */
export function isSummativeStatus(status: CycleStatus): boolean {
  return status === 'high' || status === 'probationary';
}

/** Is this staff member in a summative year? Derived from their status. */
export function isSummative(staff: CycleStatusStaff): boolean {
  return isSummativeStatus(staffCycleStatus(staff));
}

/**
 * The stored fields for a status change: the status plus the `summativeYear`
 * it implies. Every status writer spreads this so the denormalized flag
 * (still read by exports and older clients) never drifts from the status.
 * Deliberately never touches `year`.
 */
export function cycleStatusFields(status: CycleStatus): {
  cycleStatus: CycleStatus;
  summativeYear: boolean;
} {
  return { cycleStatus: status, summativeYear: isSummativeStatus(status) };
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
  cycleStatus: CycleStatus;
  summativeYear: boolean;
}

/**
 * The status the rollover preview proposes for someone landing on `year`:
 *
 *   P1-P3 (4-6)   Probationary — summatively evaluated every year
 *   year 3        High Cycle   — the summative year that closes the loop
 *   year 2        Developing
 *   year 1        Planning     (including fresh tenure out of P3)
 *
 * Only a suggestion — status is independent of year, and the admin can
 * override it per person before anything is written.
 */
export function suggestedCycleStatus(year: StaffYear): CycleStatus {
  if (year >= 4) return 'probationary';
  if (year === 3) return 'high';
  return year === 2 ? 'developing' : 'planning';
}

/**
 * Default year + status for a staff member after an annual rollover: the
 * next year in the loop, the status suggested for it, and the
 * `summativeYear` that status implies. This is a *default*: admins can
 * override the status per person in the rollover preview.
 */
export function rolloverCycle(year: StaffYear): CycleRollover {
  const next = nextCycleYear(year);
  return { year: next, ...cycleStatusFields(suggestedCycleStatus(next)) };
}
