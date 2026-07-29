import { limit, where, type QueryConstraint } from 'firebase/firestore';
import { OBSERVATION_STATUS, type Observation, type ObservationSlot } from '@ops/shared';
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

/**
 * Cap on the staff-conflict listener query — mirrors the `PAGE_LIMIT`
 * convention every other Observation-collection query in this repo already
 * follows (see MyObservationsPage.tsx, StaffDashboardPage.tsx,
 * RecentObservationsStrip.tsx, ObservationsListPage.tsx, StaffPersonPage.tsx).
 * Without it this listener would read and stream an unbounded number of
 * Draft observations on every booking-page load — the more Draft
 * observations a staff member accumulates over a school year, the larger
 * the read and the realtime payload, hitting hardest on the iPad target
 * over school wifi.
 */
export const STAFF_CONFLICT_QUERY_LIMIT = 100;

/**
 * Build the Firestore constraints for the staff-conflict listener: the
 * invitee's OTHER Draft observations, capped at STAFF_CONFLICT_QUERY_LIMIT.
 * Returns `[]` when there's no signed-in email — nothing to query yet.
 */
export function buildStaffObservationConstraints(email: string): QueryConstraint[] {
  if (!email) return [];
  return [
    where('observedEmail', '==', email),
    where('status', '==', OBSERVATION_STATUS.draft),
    limit(STAFF_CONFLICT_QUERY_LIMIT),
  ];
}

/**
 * True when the staff-conflict query may have been truncated by
 * STAFF_CONFLICT_QUERY_LIMIT (it returned exactly the cap, so there could be
 * more Draft observations beyond what was fetched).
 *
 * This is a warn-only, best-effort badge — it must never let truncation
 * masquerade as a confirmed "no conflict". When this returns true, the
 * caller must not present an un-badged slot as cleared; it only means "no
 * conflict found among the Draft observations we could see".
 */
export function isStaffConflictCheckTruncated(observationCount: number): boolean {
  return observationCount >= STAFF_CONFLICT_QUERY_LIMIT;
}

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

// `startUTC`/`endUTC` are typed as `unknown`, not `Date`, deliberately: a
// slot read straight off a Firestore snapshot (useFirestoreCollection does
// no Zod parsing) can arrive as a Timestamp, not a Date — that's exactly why
// every field is routed through `toDate()` below rather than used directly.
type SlotForConflictCheck = Pick<ObservationSlot, 'slotId'> & {
  startUTC: unknown;
  endUTC: unknown;
};

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
