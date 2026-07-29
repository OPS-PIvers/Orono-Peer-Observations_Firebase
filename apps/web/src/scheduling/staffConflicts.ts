import type { Observation, ObservationSlot } from '@ops/shared';
import { toDate } from './slotTime';

/**
 * Client-side check backing BookingPage's cross-window double-booking
 * warning (SCHED-05): flag slots that overlap ANOTHER Draft observation
 * already scheduled for the same invitee, booked through a different
 * observation window.
 *
 * Warn-only — mirrors the app's existing soft-fail philosophy for
 * scheduling conflicts (see checkSlotConflicts.ts / bookObservationSlot.ts's
 * `gcalConflictPolicy === 'warn'` path). Nothing here blocks a booking; the
 * caller (BookingPage) badges the slot the same way it already badges
 * observer-calendar conflicts via `conflictedSlotIds`.
 */

export interface BusyInterval {
  startMs: number;
  endMs: number;
}

type ObservationForConflictCheck = Pick<
  Observation,
  'windowId' | 'scheduledStartAt' | 'scheduledEndAt'
>;

/**
 * Build the invitee's busy intervals from their other Draft observations,
 * excluding any observation tied to `currentWindowId` (a reschedule within
 * the SAME window replaces that booking rather than double-booking it).
 * Observations with no `scheduledStartAt`/`scheduledEndAt` (manually
 * created, not from a booked slot) are skipped — there's nothing to
 * overlap-check against.
 */
export function staffBusyIntervalsFromObservations(
  observations: readonly ObservationForConflictCheck[],
  currentWindowId: string | null,
): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const obs of observations) {
    if (currentWindowId && obs.windowId === currentWindowId) continue;
    const start = toDate(obs.scheduledStartAt);
    const end = toDate(obs.scheduledEndAt);
    if (!start || !end) continue;
    out.push({ startMs: start.getTime(), endMs: end.getTime() });
  }
  return out;
}

type SlotForConflictCheck = Pick<ObservationSlot, 'slotId' | 'startUTC' | 'endUTC'>;

/**
 * Return the set of slot ids whose `[startUTC, endUTC)` overlaps any of the
 * given busy intervals. Simple overlap, no travel buffer — the brief and
 * owner sign-off call for the straightforward interval-overlap check used
 * elsewhere in scheduling (see autoAssignPreferences.ts's `intervalsOverlap`).
 */
export function computeStaffConflictedSlotIds(
  slots: readonly SlotForConflictCheck[],
  busyIntervals: readonly BusyInterval[],
): Set<string> {
  const conflicted = new Set<string>();
  if (busyIntervals.length === 0) return conflicted;
  for (const slot of slots) {
    const start = toDate(slot.startUTC);
    const end = toDate(slot.endUTC);
    if (!start || !end) continue;
    const startMs = start.getTime();
    const endMs = end.getTime();
    const overlaps = busyIntervals.some((b) => startMs < b.endMs && b.startMs < endMs);
    if (overlaps) conflicted.add(slot.slotId);
  }
  return conflicted;
}
