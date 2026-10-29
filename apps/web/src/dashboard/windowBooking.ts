import { OBSERVATION_WINDOW_STATUS, type WindowInviteView } from '@ops/shared';
import type { DeriveContext } from './dashboardEvents';

/**
 * Window statuses the dashboard subscribes to. A window leaves
 * `open`/`partially-booked` once every invitee books (`fully-booked`, set by
 * bookObservationSlot) or its booking period ends (`expired`) — but the
 * staff member's booking in it is still real, so the sign-up step must keep
 * reading as done. Only `cancelled` windows are left out.
 */
export const DASHBOARD_WINDOW_STATUSES = [
  OBSERVATION_WINDOW_STATUS.open,
  OBSERVATION_WINDOW_STATUS.partiallyBooked,
  OBSERVATION_WINDOW_STATUS.fullyBooked,
  OBSERVATION_WINDOW_STATUS.expired,
] as const;

/** Windows that still accept bookings — the only ones the booking CTA may
 *  point at. */
const BOOKABLE_STATUSES: ReadonlySet<string> = new Set([
  OBSERVATION_WINDOW_STATUS.open,
  OBSERVATION_WINDOW_STATUS.partiallyBooked,
]);

/** First day (YYYY-MM-DD) of the school year containing `now` (Aug 1),
 *  matching the dashboard's "2025 — 2026" cycle label. */
export function schoolYearStartYmd(now: Date): string {
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${String(startYear)}-08-01`;
}

/**
 * The booking signals the dashboard derives from a staff member's invite
 * views (their own slice of each window they're invited to):
 *   - `openBooking` — an unbooked invite in a window that is still bookable.
 *   - `hasBookedSlot` — a booked invite in any window ending this school
 *     year. Fully-booked and expired windows are never deleted, so without
 *     the school-year bound last year's booking would mark this year's
 *     sign-up step done.
 */
export function summarizeWindowBookings(
  views: readonly WindowInviteView[],
  staffEmail: string,
  now: Date = new Date(),
): Pick<DeriveContext, 'openBooking' | 'hasBookedSlot'> {
  const email = staffEmail.toLowerCase();
  const yearStart = schoolYearStartYmd(now);
  let openBooking: DeriveContext['openBooking'] = null;
  let hasBookedSlot = false;
  for (const v of views) {
    if (v.email.toLowerCase() !== email) continue;
    const first = v.entries[0];
    if (!first) continue;
    if (v.entries.some((e) => e.bookedSlotId)) {
      if (v.endDate >= yearStart) hasBookedSlot = true;
    } else if (!openBooking && BOOKABLE_STATUSES.has(v.status)) {
      openBooking = {
        windowId: v.windowId,
        token: first.inviteToken,
        endDate: v.endDate ? new Date(`${v.endDate}T12:00:00`) : null,
      };
    }
  }
  return { openBooking, hasBookedSlot };
}
