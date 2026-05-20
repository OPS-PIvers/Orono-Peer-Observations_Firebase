import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_WINDOW_STATUS, type ObservationWindow } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/** Today's calendar date in Chicago as YYYY-MM-DD. */
function chicagoToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
}

/**
 * Daily job that expires windows whose booking period has fully elapsed.
 *
 * A window in `open` or `partially-booked` whose `endDate` (a building-local
 * YYYY-MM-DD) is strictly before today's Chicago date is set to `expired`.
 * Runs at 07:30 America/Chicago (after the 07:00 reminder job). No email.
 */
export const expireObservationWindows = onSchedule(
  {
    schedule: 'every day 07:30',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const db = getFirestore();
    const today = chicagoToday(new Date());

    const snap = await db
      .collection(COLLECTIONS.observationWindows)
      .where('status', 'in', [
        OBSERVATION_WINDOW_STATUS.open,
        OBSERVATION_WINDOW_STATUS.partiallyBooked,
      ])
      .get();

    const now = FieldValue.serverTimestamp();
    const expired: string[] = [];

    for (const docSnap of snap.docs) {
      const window = docSnap.data() as ObservationWindow;
      if (window.endDate < today) {
        await docSnap.ref.update({ status: OBSERVATION_WINDOW_STATUS.expired, updatedAt: now });
        expired.push(docSnap.id);
      }
    }

    if (expired.length > 0) {
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: now,
        userEmail: 'system',
        action: 'observationWindow.expire',
        target: COLLECTIONS.observationWindows,
        details: { today, expiredCount: expired.length, windowIds: expired },
      });
    }
    logger.info('expireObservationWindows: done', {
      scanned: snap.size,
      expired: expired.length,
      today,
    });
  },
);
