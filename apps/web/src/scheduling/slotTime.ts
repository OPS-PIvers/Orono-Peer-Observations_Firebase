import { Timestamp } from 'firebase/firestore';

/**
 * `startUTC`/`endUTC` are declared as dates in the shared schema but arrive
 * from Firestore as {@link Timestamp} objects on live snapshots. Normalize
 * either shape (Timestamp, Date, or millis) to a `Date`.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

/** Format an instant as a building-local (America/Chicago) clock time. */
export function formatLocalTime(value: unknown): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format an instant as a building-local (America/Chicago) date + time. */
export function formatLocalDateTime(value: unknown): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format a YYYY-MM-DD local date string as a friendly weekday + date. */
export function formatYMD(ymd: string): string {
  const date = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
