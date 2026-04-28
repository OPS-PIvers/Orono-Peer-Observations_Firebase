import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from '@ops/shared';

if (getApps().length === 0) initializeApp();

const DEFAULT_RETENTION_DAYS = 365;
const DELETE_BATCH_SIZE = 400;

/**
 * Daily scheduled prune of the /auditLog collection. The retention window
 * is configurable via `appSettings/global.auditLogRetentionDays` (default
 * 365). Anything older than the cutoff is deleted in batches of 400.
 *
 * Runs at 03:05 America/Chicago — after midnight local but well before
 * the morning sign-in spike.
 */
export const pruneAuditLog = onSchedule(
  {
    schedule: 'every day 03:05',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const db = getFirestore();
    const settingsSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
    const retentionDays = settingsSnap.exists
      ? ((settingsSnap.data()?.['auditLogRetentionDays'] as number | undefined) ??
        DEFAULT_RETENTION_DAYS)
      : DEFAULT_RETENTION_DAYS;

    const cutoff = Timestamp.fromMillis(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let deleted = 0;
    let more = true;

    while (more) {
      const batch = await db
        .collection(COLLECTIONS.auditLog)
        .where('timestamp', '<', cutoff)
        .orderBy('timestamp')
        .limit(DELETE_BATCH_SIZE)
        .get();
      if (batch.empty) {
        more = false;
        break;
      }

      const writer = db.batch();
      for (const doc of batch.docs) writer.delete(doc.ref);
      await writer.commit();
      deleted += batch.size;

      // If we got a full batch there may be more; loop again. Otherwise we
      // know we're done without an extra query.
      more = batch.size === DELETE_BATCH_SIZE;
    }

    logger.info('pruneAuditLog: complete', { retentionDays, deleted, cutoff: cutoff.toDate() });
  },
);
