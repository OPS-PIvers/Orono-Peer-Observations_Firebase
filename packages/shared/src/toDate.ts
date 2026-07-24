/**
 * Coerce a Firestore Timestamp / JS Date / ISO string / epoch-ms number into a
 * real `Date`.
 *
 * Consolidates five near-identical `toDate()` helpers that grew independently
 * in apps/functions (googleCalendar.ts, regenerateObservationPdf.ts,
 * blocking.ts, schedulingEmail.ts, onBuildingScheduleWritten.ts). Those
 * differed only in which input shapes they bothered to handle and in what
 * they returned for unparseable input (`null`, `undefined`, or `new
 * Date(NaN)`); this is the union of every shape they accepted.
 *
 * `@ops/shared` has no dependency on `firebase-admin`, so Firestore
 * `Timestamp` values are matched structurally (duck-typed via `.toDate()`)
 * rather than via `instanceof`.
 *
 * Returns `null` when `value` is not a recognizable date-like value, or when
 * a string/number fails to parse. Callers that need a concrete (possibly
 * invalid) `Date` instead of `null` can do `toDate(value) ?? new Date(NaN)`;
 * callers that want `undefined` on failure can do `toDate(value) ??
 * undefined`.
 */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;

  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      const d = (value as { toDate: () => unknown }).toDate();
      return d instanceof Date ? d : null;
    } catch {
      return null;
    }
  }

  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }

  return null;
}
