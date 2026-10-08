import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';
import { DRIVE_SERVICE_ACCOUNT } from '../lib/drive.js';
import { deleteTranscriptionAudio } from '../lib/transcriptionStorage.js';

if (getApps().length === 0) initializeApp();

/**
 * Jobs whose `geminiFileUri` is still set this long after creation are
 * assumed to be orphans — the worker function instance died before its
 * finally-block cleanup ran. The Cloud Function's own timeout is 9
 * minutes, so anything older than this is safely past the worker's
 * lifecycle.
 */
const ORPHAN_AGE_HOURS = 6;
const SWEEP_BATCH_SIZE = 50;

/**
 * Daily sweep that deletes scratch audio (a gs:// object in the transcription
 * bucket) which was persisted onto a transcriptionJob doc but never cleaned up
 * by the worker (e.g. because the function instance was killed by timeout/OOM
 * between upload and the finally block), then clears the pointer on the job.
 *
 * The bucket's 1-day lifecycle rule deletes the object regardless, so this is
 * defense-in-depth. Legacy Gemini Files URIs are just cleared (they expire
 * on Google's side after 48 hours).
 *
 * Runs at 04:15 America/Chicago — after pruneAuditLog (03:05).
 */
export const pruneOrphanGeminiFiles = onSchedule(
  {
    schedule: 'every day 04:15',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    // Same account as the transcription worker, which already has object
    // access to the scratch bucket.
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(Date.now() - ORPHAN_AGE_HOURS * 60 * 60 * 1000);

    // Single-field inequality only — combining `!=` with `<` on a different
    // field would require a composite index. The set of jobs with a
    // non-null geminiFileUri is naturally small (in-flight + orphans), so
    // we filter the age in code.
    const snap = await db
      .collection(COLLECTIONS.transcriptionJobs)
      .where('geminiFileUri', '!=', null)
      .limit(SWEEP_BATCH_SIZE)
      .get();

    let cleaned = 0;
    let failed = 0;
    let skippedYoung = 0;

    for (const doc of snap.docs) {
      const fileUri = doc.get('geminiFileUri') as string | null;
      const createdAt = doc.get('createdAt') as Timestamp | undefined;
      if (!fileUri) continue;
      if (createdAt && createdAt.toMillis() > cutoff.toMillis()) {
        // Job is recent — let the in-process worker handle cleanup.
        skippedYoung += 1;
        continue;
      }
      try {
        await deleteTranscriptionAudio(fileUri);
        await doc.ref.update({ geminiFileUri: null });
        cleaned += 1;
      } catch (err) {
        failed += 1;
        logger.warn('pruneOrphanGeminiFiles: delete failed', {
          jobId: doc.id,
          fileUri,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('pruneOrphanGeminiFiles: complete', {
      scanned: snap.size,
      cleaned,
      failed,
      skippedYoung,
      cutoff: cutoff.toDate(),
    });
  },
);
