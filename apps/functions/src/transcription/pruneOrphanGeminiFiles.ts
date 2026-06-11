import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';

if (getApps().length === 0) initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_FILES_BASE = 'https://generativelanguage.googleapis.com';

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
 * Daily sweep that deletes Gemini Files API temp uploads which were
 * persisted onto a transcriptionJob doc but never cleaned up by the
 * worker (e.g. because the function instance was killed by timeout/OOM
 * between upload and the finally block).
 *
 * Gemini auto-deletes files after 48 hours regardless, so this is
 * defense-in-depth to keep the project quota tidy.
 *
 * This sweep only reclaims leaked files — it does NOT touch job status.
 * Moving abandoned Pending/Running jobs to Failed is owned by the hourly
 * sweepStaleTranscriptionJobs.
 *
 * Runs at 04:15 America/Chicago — after pruneAuditLog (03:05).
 */
export const pruneOrphanGeminiFiles = onSchedule(
  {
    schedule: 'every day 04:15',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    secrets: [GEMINI_API_KEY],
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
        await deleteGeminiFile(fileUri, GEMINI_API_KEY.value());
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

async function deleteGeminiFile(fileUri: string, apiKey: string): Promise<void> {
  const fileName = fileUri.startsWith('https://')
    ? fileUri.split('/files/')[1]
    : fileUri.replace(/^files\//, '');
  if (!fileName) throw new Error(`Unrecognized Gemini file URI: ${fileUri}`);

  const res = await fetch(
    `${GEMINI_FILES_BASE}/v1beta/files/${fileName}?key=${encodeURIComponent(apiKey)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini Files delete failed ${String(res.status)}: ${text.slice(0, 200)}`);
  }
}
