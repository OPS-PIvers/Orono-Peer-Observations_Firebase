import type { ObservationWindow } from '@ops/shared';

/**
 * Batch jobs over /observationWindows read every open window. One document
 * that isn't the shape createObservationWindow writes (a bad import, a
 * hand edit) must not stop the job for everyone else, so the jobs check the
 * fields they iterate before using them and skip a window that fails.
 *
 * This checks only what the jobs dereference: string dates and an
 * `invitees` array of objects with string `email` and `buildingId`.
 */
export function isProcessableWindow(data: unknown): data is ObservationWindow {
  if (typeof data !== 'object' || data === null) return false;
  const w = data as Record<string, unknown>;
  if (typeof w['endDate'] !== 'string' || typeof w['startDate'] !== 'string') return false;
  const invitees = w['invitees'];
  if (!Array.isArray(invitees)) return false;
  return invitees.every(
    (inv: unknown) =>
      typeof inv === 'object' &&
      inv !== null &&
      typeof (inv as Record<string, unknown>)['email'] === 'string' &&
      typeof (inv as Record<string, unknown>)['buildingId'] === 'string',
  );
}
