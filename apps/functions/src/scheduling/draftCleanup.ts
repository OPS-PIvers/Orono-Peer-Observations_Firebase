import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';
import { deleteObservationEvent } from '../calendar/lib/googleCalendar.js';

/**
 * Best-effort teardown of a Draft observation spawned from a booking: cancels
 * any Google Calendar events for both parties, then deletes the observation
 * doc.
 *
 * No-ops (returns false) when the observation is missing or already Finalized
 * — a finalized observation has a Drive folder shared with the observed staff
 * member, so it must be preserved even if the originating window/booking is
 * later cancelled.
 *
 * Shared by cancelBooking (single booking) and cancelObservationWindow (every
 * booking in the window) so both tear bookings down identically.
 */
export async function deleteDraftObservation(
  db: Firestore,
  observationId: string,
): Promise<boolean> {
  const obsRef = db.collection(COLLECTIONS.observations).doc(observationId);
  const obsSnap = await obsRef.get();
  if (!obsSnap.exists || obsSnap.data()?.['status'] !== OBSERVATION_STATUS.draft) {
    return false;
  }

  const obsData = obsSnap.data() ?? {};
  const gcalEventIds = (obsData['gcalEventIds'] ?? {}) as {
    observer?: string;
    observed?: string;
  };
  const observerEmail: unknown = obsData['observerEmail'];
  const observedEmail: unknown = obsData['observedEmail'];
  const calCleanup: Promise<void>[] = [];
  if (gcalEventIds.observer && typeof observerEmail === 'string') {
    calCleanup.push(deleteObservationEvent(observerEmail, gcalEventIds.observer));
  }
  if (gcalEventIds.observed && typeof observedEmail === 'string') {
    calCleanup.push(deleteObservationEvent(observedEmail, gcalEventIds.observed));
  }
  await Promise.all(calCleanup).catch((err: unknown) =>
    logger.warn('deleteDraftObservation: calendar event cleanup failed', err),
  );

  await obsRef.delete();
  return true;
}
