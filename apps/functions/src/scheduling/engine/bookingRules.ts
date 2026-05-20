/**
 * Pure booking-policy helpers shared by the booking / assignment callables.
 *
 * Kept side-effect free so they can be unit-tested without Firestore. The
 * Firestore transactions in bookObservationSlot / submitDayPreference /
 * assignObservationFromPreference call these to make their go/no-go decisions.
 */

/**
 * True when a slot may still be booked given a minimum lead time.
 *
 * Booking is blocked when the slot starts within `leadTimeHours` hours of
 * `nowMs`. A `leadTimeHours` of 0 allows booking right up to (and including)
 * the slot start.
 */
export function meetsLeadTime(slotStartMs: number, nowMs: number, leadTimeHours: number): boolean {
  const leadMs = leadTimeHours * 60 * 60 * 1000;
  return slotStartMs - nowMs >= leadMs;
}

/**
 * True when a day still has room under a per-day cap.
 *
 * `cap === null` means uncapped (always true). Otherwise the current count
 * for the day must be strictly below the cap.
 */
export function dayHasCapacity(currentCount: number, cap: number | null): boolean {
  if (cap === null) return true;
  return currentCount < cap;
}

/**
 * Recompute a window's `dayCounts` when an invitee's day preference changes.
 *
 * Decrements the previous day (if any, never below zero) and increments the
 * new day. Returns a fresh map; the input is not mutated. Pass `previousYMD`
 * as null for a brand-new preference.
 */
export function applyDayCountChange(
  dayCounts: Record<string, number>,
  newYMD: string,
  previousYMD: string | null,
): Record<string, number> {
  const next: Record<string, number> = { ...dayCounts };
  if (previousYMD !== null && previousYMD !== newYMD) {
    const prev = next[previousYMD] ?? 0;
    next[previousYMD] = Math.max(0, prev - 1);
  }
  if (previousYMD !== newYMD) {
    next[newYMD] = (next[newYMD] ?? 0) + 1;
  }
  return next;
}
