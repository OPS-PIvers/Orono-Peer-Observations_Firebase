import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type Observation, type ObservationWindow } from '@ops/shared';
import {
  GOOGLE_OAUTH_CLIENT_SECRET,
  createObservationEvent,
  getCalendarClientFor,
} from './lib/googleCalendar.js';

if (getApps().length === 0) initializeApp();

/** True when `gcalEventIds` carries no created ids yet. */
function eventIdsEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== 'object') return true;
  const obj = value as Record<string, unknown>;
  return !obj['observer'] && !obj['observed'];
}

/**
 * Create Google Calendar events when an observation is booked.
 *
 * Fires once per booking: only when the after-doc has a windowId AND
 * scheduledStartAt AND gcalEventIds is still empty. After creating the event(s)
 * we write gcalEventIds back — which re-triggers this function, but the
 * now-populated gcalEventIds guard short-circuits it, preventing a loop.
 *
 * Best-effort: a missing/revoked token for either party is logged to /auditLog
 * and never throws. One party's failure does not block the other.
 */
export const onObservationBooked = onDocumentWritten(
  {
    document: 'observations/{observationId}',
    region: 'us-central1',
    secrets: [GOOGLE_OAUTH_CLIENT_SECRET],
    memory: '256MiB',
  },
  async (event) => {
    const after = event.data?.after.exists
      ? (event.data.after.data() as Record<string, unknown> | undefined)
      : null;
    if (!after) return;

    const windowId = after['windowId'];
    const scheduledStartAt = after['scheduledStartAt'];
    if (!windowId || typeof windowId !== 'string') return;
    if (!scheduledStartAt) return;
    if (!eventIdsEmpty(after['gcalEventIds'])) return; // already created → no loop

    const observationId = event.params.observationId;
    const observation = { ...(after as object), observationId } as unknown as Observation;
    const db = getFirestore();

    // Load the window for calendar title/description/sendUpdates.
    const windowSnap = await db.collection(COLLECTIONS.observationWindows).doc(windowId).get();
    if (!windowSnap.exists) {
      logger.warn('onObservationBooked: window not found', { observationId, windowId });
      return;
    }
    const window = windowSnap.data() as ObservationWindow;

    // Resolve both calendar clients (best-effort; null when not connected).
    const [observerCal, observedCal] = await Promise.all([
      getCalendarClientFor(observation.observerEmail).catch((err: unknown) => {
        logger.warn('onObservationBooked: observer calendar resolve failed', {
          observationId,
          err,
        });
        return null;
      }),
      getCalendarClientFor(observation.observedEmail).catch((err: unknown) => {
        logger.warn('onObservationBooked: observed calendar resolve failed', {
          observationId,
          err,
        });
        return null;
      }),
    ]);

    if (!observerCal && !observedCal) {
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: Timestamp.now(),
        userEmail: observation.observerEmail,
        action: 'calendar.eventSkipped',
        target: `${COLLECTIONS.observations}/${observationId}`,
        details: {
          observationId,
          reason: 'Neither observer nor observed has a connected calendar.',
        },
      });
      return;
    }

    let eventIds;
    try {
      eventIds = await createObservationEvent({ observation, window, observerCal, observedCal });
    } catch (err) {
      logger.error('onObservationBooked: event creation failed (non-fatal)', {
        observationId,
        err,
      });
      return;
    }

    if (!eventIds.observer && !eventIds.observed) {
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: Timestamp.now(),
        userEmail: observation.observerEmail,
        action: 'calendar.eventCreateFailed',
        target: `${COLLECTIONS.observations}/${observationId}`,
        details: { observationId, reason: 'No event was created on either calendar.' },
      });
      return;
    }

    // Write the ids back. This re-fires the trigger, but the gcalEventIds
    // guard above short-circuits it.
    await db
      .collection(COLLECTIONS.observations)
      .doc(observationId)
      .update({ gcalEventIds: eventIds })
      .catch((err: unknown) =>
        logger.error('onObservationBooked: failed to write gcalEventIds', { observationId, err }),
      );
  },
);
