import type { calendar_v3 } from 'googleapis';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type Observation, type ObservationWindow } from '@ops/shared';
import {
  GOOGLE_OAUTH_CLIENT_SECRET,
  buildObservationEventContent,
  createObservationEvent,
  getCalendarClientFor,
  toDate,
  updateObservationEvent,
} from './lib/googleCalendar.js';

if (getApps().length === 0) initializeApp();

/** True when `gcalEventIds` carries no created ids yet. */
function eventIdsEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== 'object') return true;
  const obj = value as Record<string, unknown>;
  return !obj['observer'] && !obj['observed'];
}

/** The observation fields a calendar event's title/time depend on. */
const SYNCED_FIELDS = ['observationName', 'type', 'scheduledStartAt', 'scheduledEndAt'] as const;

/** True when none of the fields a calendar event is derived from changed
 *  between `before` and `after` — used to avoid pointless Calendar API
 *  calls (and any re-trigger loop) on unrelated observation edits. */
function relevantFieldsUnchanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return SYNCED_FIELDS.every((field) => {
    const beforeVal = before[field];
    const afterVal = after[field];
    // Times may arrive as Firestore Timestamps; compare via ISO instant so
    // equal instants encoded differently don't look like a change.
    if (field === 'scheduledStartAt' || field === 'scheduledEndAt') {
      const b = toDate(beforeVal);
      const a = toDate(afterVal);
      return (b?.getTime() ?? null) === (a?.getTime() ?? null);
    }
    return beforeVal === afterVal;
  });
}

/**
 * Patch already-created Google Calendar events when a booked observation's
 * name, type, or scheduled time changes. Best-effort and a no-op unless
 * gcalEventIds is already populated and one of SYNCED_FIELDS actually moved,
 * so it never fights with onObservationBooked's own creation write.
 */
async function syncObservationEvent(
  db: FirebaseFirestore.Firestore,
  observationId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  if (relevantFieldsUnchanged(before, after)) return;

  const windowId = after['windowId'];
  if (!windowId || typeof windowId !== 'string') return;

  const eventIds = after['gcalEventIds'] as { observer?: string; observed?: string } | undefined;
  if (!eventIds?.observer && !eventIds?.observed) return;

  const observation = { ...(after as object), observationId } as unknown as Observation;
  const start = toDate(observation.scheduledStartAt);
  const end = toDate(observation.scheduledEndAt);
  if (!start || !end) return;

  const windowSnap = await db.collection(COLLECTIONS.observationWindows).doc(windowId).get();
  if (!windowSnap.exists) {
    logger.warn('syncObservationEvent: window not found', { observationId, windowId });
    return;
  }
  const window = windowSnap.data() as ObservationWindow;
  const { summary, description } = buildObservationEventContent(observation, window);
  const sendUpdates: 'none' | 'all' = window.gcalSendUpdates === 'all' ? 'all' : 'none';

  const patch: calendar_v3.Schema$Event = {
    summary,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };

  const patches: Promise<void>[] = [];
  if (eventIds.observer) {
    patches.push(
      updateObservationEvent(window.observerEmail, eventIds.observer, patch, sendUpdates),
    );
  }
  if (eventIds.observed) {
    patches.push(
      updateObservationEvent(observation.observedEmail, eventIds.observed, patch, sendUpdates),
    );
  }
  await Promise.all(patches);

  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: Timestamp.now(),
    userEmail: observation.observerEmail,
    action: 'calendar.eventUpdated',
    target: `${COLLECTIONS.observations}/${observationId}`,
    details: { observationId, fields: SYNCED_FIELDS },
  });
}

/**
 * Create Google Calendar events when an observation is booked, and keep them
 * in sync afterward.
 *
 * Creation fires once per booking: only when the after-doc has a windowId AND
 * scheduledStartAt AND gcalEventIds is still empty. After creating the event(s)
 * we write gcalEventIds back — which re-triggers this function, but the
 * now-populated gcalEventIds guard short-circuits it, preventing a loop.
 *
 * Once events exist, later writes are diffed: if observationName, type, or
 * the scheduled start/end actually changed, the existing events are patched
 * in place via updateObservationEvent. Any other field edit (notes, evidence,
 * status, …) is a no-op here, so this never loops or spams the Calendar API.
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

    if (!eventIdsEmpty(after['gcalEventIds'])) {
      // Events already exist for this observation — sync instead of create.
      const before = event.data?.before.exists
        ? (event.data.before.data() as Record<string, unknown> | undefined)
        : null;
      const observationId = event.params.observationId;
      if (before) {
        await syncObservationEvent(getFirestore(), observationId, before, after).catch(
          (err: unknown) =>
            logger.warn('onObservationBooked: event sync failed (non-fatal)', {
              observationId,
              err,
            }),
        );
      }
      return; // already created → never re-create, no loop
    }

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
