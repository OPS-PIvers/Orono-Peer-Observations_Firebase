import { OBSERVATION_YEARS, type StaffYear } from '@ops/shared';
import {
  CYCLE_STATUSES,
  type CycleStatus,
  cycleStatus,
  cycleStatusFields,
  displayYear,
  staffCycleStatus,
} from '@ops/shared';
import { cycleStatusLabel } from '@/utils/staffFormatting';

// Cycle status/year logic lives in @ops/shared; re-exported here so existing
// web imports keep working. Labels stay web-local.
export {
  CYCLE_STATUSES,
  cycleStatus,
  cycleStatusFields,
  cycleStatusLabel,
  displayYear,
  staffCycleStatus,
};
export type { CycleStatus };

/**
 * Every stored year, in picker order: Y1, Y2, Y3, P1, P2, P3.
 *
 * Year and Status are independent controls. The Year picker writes only
 * `year` (which alone decides assigned domains); the Status picker writes
 * only `cycleStatus` + its synced `summativeYear` (`cycleStatusFields`).
 * Neither ever moves the other, and no combination is forbidden — how
 * Probationary status relates to the P-years is still an open question for
 * the peer evaluation team.
 */
export const STAFF_YEARS: readonly StaffYear[] = OBSERVATION_YEARS;

/** Sort key for the Status column: the phases in their `CYCLE_STATUSES` order. */
export function cycleStatusOrder(status: CycleStatus): number {
  return CYCLE_STATUSES.indexOf(status);
}
