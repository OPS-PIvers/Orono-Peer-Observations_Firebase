/**
 * Helpers for rendering America/Chicago-local date/time strings used by the
 * scheduling email templates (windowInvite, bookingConfirmation,
 * assignmentNotice, bookingCancelled, windowExpired).
 *
 * Slot/window timestamps are stored as absolute UTC instants (Firestore
 * Timestamps); templates show them in the district's local zone.
 */

const TZ = 'America/Chicago';

/** Coerce a Firestore Timestamp / Date / number / ISO string into a Date. */
export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    return (value as { toDate(): Date }).toDate();
  }
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  return new Date(NaN);
}

/** e.g. "Monday, March 10, 2025" in Chicago local time. */
export function formatChicagoDate(value: unknown): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

/** e.g. "9:15 AM" in Chicago local time. */
export function formatChicagoTime(value: unknown): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

/** Format a building-local YYYY-MM-DD as a readable date (no zone math). */
export function formatYMD(ymd: string): string {
  const parts = ymd.split('-').map(Number);
  const [y, m, d] = parts as [number, number, number];
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(dt);
}
