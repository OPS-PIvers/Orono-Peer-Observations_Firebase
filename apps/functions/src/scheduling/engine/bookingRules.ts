import { OBSERVATION_SLOT_STATUS } from '@ops/shared';
import type { ObservationSlot, Staff, WindowInvitee } from '@ops/shared';

/**
 * Pure booking-policy helpers shared by the booking / assignment callables.
 *
 * Kept side-effect free so they can be unit-tested without Firestore. The
 * Firestore transactions in bookObservationSlot / submitDayPreference /
 * assignObservationFromPreference call these to make their go/no-go decisions.
 */

/** The observed staff member's denormalized identity stamped onto a draft. */
export interface ObservedIdentity {
  name: string;
  role: string;
  year: number;
  buildings: string[];
}

/**
 * Resolve the name/role/year/buildings to stamp onto a draft observation
 * created from a booking.
 *
 * Prefers the live /staff doc, then the window invitee snapshot (resolved
 * from /staff when the window was created), and only as a last resort falls
 * back to placeholders. This avoids stamping a wrong role ('unknown') or
 * year (1) when the staff doc is momentarily missing at booking time.
 */
export function resolveObservedIdentity(
  staffEmail: string,
  staff: Staff | null,
  invitee: WindowInvitee | undefined,
): ObservedIdentity {
  return {
    name: staff?.name ?? invitee?.name ?? staffEmail,
    role: staff?.role ?? invitee?.role ?? 'unknown',
    year: staff?.year ?? invitee?.year ?? 1,
    buildings: staff?.buildings ?? invitee?.buildings ?? [],
  };
}

/** Today's calendar date in America/Chicago as a YYYY-MM-DD string. */
export function chicagoDateString(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
}

/**
 * True when a window's booking period has fully elapsed.
 *
 * A window's `endDate` is a building-local YYYY-MM-DD; once the current
 * Chicago calendar date is past it, no further booking / day-preference /
 * assignment may happen. Compared lexicographically, which is valid for the
 * zero-padded ISO date format both sides use.
 */
export function isWindowBookingClosed(endDate: string, now: Date): boolean {
  return endDate < chicagoDateString(now);
}

/**
 * The observationIds of every booked slot in a window, so a window
 * cancellation can tear down the Draft observations those bookings spawned.
 * (The caller's deleteDraftObservation skips any that are already Finalized.)
 */
export function bookedSlotObservationIds(slots: ObservationSlot[]): string[] {
  const ids: string[] = [];
  for (const slot of slots) {
    if (slot.status === OBSERVATION_SLOT_STATUS.booked && slot.observationId) {
      ids.push(slot.observationId);
    }
  }
  return ids;
}

/**
 * True when a cancelled booking's slot matches a day-preference's assignment,
 * meaning the preference must revert to unassigned so the PE can re-assign it.
 */
export function preferenceShouldRevert(
  assignedSlotId: string | null | undefined,
  cancelledSlotId: string,
): boolean {
  return assignedSlotId != null && assignedSlotId === cancelledSlotId;
}

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
