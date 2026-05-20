import type { PeBusyInterval } from '@ops/shared';

/**
 * Pure interval-overlap helpers for observation scheduling.
 *
 * The bookable resource is the evaluator's wall-clock time. Two intervals
 * "conflict" when they overlap once each side is padded by a travel buffer
 * (time the PE needs to move between buildings). All math is in absolute
 * milliseconds, so callers must pass UTC instants.
 */

/**
 * True when `[aStart, aEnd)` overlaps `[bStart, bEnd)` after padding the B
 * interval by `bufferMs` on both ends.
 *
 * With `bufferMs === 0` adjacency is allowed: an interval ending exactly when
 * another begins does NOT overlap (strict `<`).
 */
export function intervalsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
  bufferMs: number,
): boolean {
  return aStartMs < bEndMs + bufferMs && bStartMs < aEndMs + bufferMs;
}

/**
 * True when the slot `[slotStartUTC, slotEndUTC)` conflicts with any busy
 * interval on the evaluator's ledger, padded by `bufferMinutes`.
 *
 * The interval whose `slotId === ignoreSlotId` is skipped — used when
 * recomputing a slot against a ledger that may already contain that slot's
 * own booking.
 */
export function peConflicts(
  slotStartUTC: Date,
  slotEndUTC: Date,
  peBusy: PeBusyInterval[],
  bufferMinutes: number,
  ignoreSlotId?: string,
): boolean {
  const bufferMs = bufferMinutes * 60_000;
  const aStartMs = slotStartUTC.getTime();
  const aEndMs = slotEndUTC.getTime();

  for (const busy of peBusy) {
    if (ignoreSlotId !== undefined && busy.slotId === ignoreSlotId) continue;
    const bStartMs = busy.startUTC.getTime();
    const bEndMs = busy.endUTC.getTime();
    if (intervalsOverlap(aStartMs, aEndMs, bStartMs, bEndMs, bufferMs)) {
      return true;
    }
  }
  return false;
}
