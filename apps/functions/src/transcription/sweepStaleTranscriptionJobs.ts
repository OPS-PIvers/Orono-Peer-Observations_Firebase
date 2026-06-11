import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Jobs still Pending/Running this long after creation are considered dead.
 * The worker (onTranscriptionJobCreated) has a 9-minute timeout, so one hour
 * is comfortably past any legitimately in-flight job's lifecycle.
 */
export const STALE_JOB_MAX_AGE_MS = 60 * 60 * 1000;

/** Error message written onto jobs the sweep marks Failed. */
export const STALE_JOB_ERROR = 'Worker timed out';

const SWEEP_BATCH_SIZE = 200;

/**
 * True when an in-flight (Pending/Running) job is old enough that its worker
 * must be dead. A missing `createdAt` (malformed doc) is treated as stale so
 * it can never block re-transcription forever.
 *
 * Shared by the hourly sweep below and by requestTranscription's in-flight
 * idempotency check (stale jobs must not suppress new requests).
 */
export function isStaleTranscriptionJob(
  createdAt: Timestamp | null | undefined,
  nowMillis: number,
): boolean {
  if (!createdAt) return true;
  return nowMillis - createdAt.toMillis() >= STALE_JOB_MAX_AGE_MS;
}

/**
 * Hourly sweep that moves abandoned transcription jobs to a terminal state.
 *
 * onTranscriptionJobCreated sets status='Running' before its try/catch and
 * runs without retries, so a timeout/OOM/crash strands the job in
 * Pending/Running forever. That stranded job (a) shows a perpetual spinner in
 * the UI and (b) used to permanently block re-transcription via
 * requestTranscription's in-flight check. This sweep marks any Pending or
 * Running job older than STALE_JOB_MAX_AGE_MS as Failed with
 * error='Worker timed out', which surfaces the failure to the user and
 * unblocks re-requests.
 *
 * `geminiFileUri` is deliberately left untouched — pruneOrphanGeminiFiles
 * owns deleting leaked Gemini files (its query is status-agnostic).
 *
 * The query filters status only (automatic single-field index) and checks age
 * in code; combining `in` with a `createdAt` range would need a composite
 * index, and the Pending/Running set is naturally tiny.
 */
export const sweepStaleTranscriptionJobs = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const db = getFirestore();
    const now = Date.now();

    const snap = await db
      .collection(COLLECTIONS.transcriptionJobs)
      .where('status', 'in', ['Pending', 'Running'])
      .limit(SWEEP_BATCH_SIZE)
      .get();

    let failed = 0;
    let errored = 0;
    let skippedFresh = 0;

    for (const doc of snap.docs) {
      const createdAt = doc.get('createdAt') as Timestamp | null | undefined;
      if (!isStaleTranscriptionJob(createdAt, now)) {
        skippedFresh += 1;
        continue;
      }
      try {
        await doc.ref.update({
          status: 'Failed',
          completedAt: FieldValue.serverTimestamp(),
          error: STALE_JOB_ERROR,
        });
        failed += 1;
      } catch (err) {
        errored += 1;
        logger.warn('sweepStaleTranscriptionJobs: update failed', {
          jobId: doc.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('sweepStaleTranscriptionJobs: complete', {
      scanned: snap.size,
      failed,
      errored,
      skippedFresh,
    });
  },
);
