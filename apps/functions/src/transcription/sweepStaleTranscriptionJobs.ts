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

/**
 * Terminal-state jobs (Completed/Failed) older than this many days are
 * pruned from the database to prevent unbounded growth. Matches the retention
 * window for audit logs. This prevents the transcriptPreview field (which
 * carries the first 280 chars of classroom audio) from being retained forever.
 */
export const COMPLETED_JOB_RETENTION_DAYS = 90;

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
 * True when a terminal-state job is old enough to be pruned. A missing
 * `completedAt` (malformed doc) is treated as pruneable so malformed jobs
 * don't linger forever.
 */
export function isCompletedJobPrunable(
  completedAt: Timestamp | null | undefined,
  nowMillis: number,
): boolean {
  if (!completedAt) return true;
  return nowMillis - completedAt.toMillis() >= COMPLETED_JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Hourly sweep that (1) moves abandoned transcription jobs to a terminal state,
 * and (2) prunes terminal-state jobs older than the retention window.
 *
 * Phase 1: onTranscriptionJobCreated sets status='Running' before its try/catch
 * and runs without retries, so a timeout/OOM/crash strands the job in
 * Pending/Running forever. That stranded job (a) shows a perpetual spinner in
 * the UI and (b) used to permanently block re-transcription via
 * requestTranscription's in-flight check. This sweep marks any Pending or
 * Running job older than STALE_JOB_MAX_AGE_MS as Failed with
 * error='Worker timed out', which surfaces the failure to the user and
 * unblocks re-requests.
 *
 * Phase 2: Completed/Failed jobs carry a transcriptPreview field (first 280
 * chars of classroom audio) that is never deleted. Over years of use this
 * causes unbounded growth and retains fragments of deleted observations'
 * audio content. This phase deletes terminal-state jobs older than
 * COMPLETED_JOB_RETENTION_DAYS, keeping only recent transcripts available
 * for reference.
 *
 * `geminiFileUri` is deliberately left untouched in phase 1 — pruneOrphanGeminiFiles
 * owns deleting leaked Gemini files (its query is status-agnostic).
 *
 * The queries filter status only (automatic single-field index) and check age
 * in code; combining with timestamp ranges would need composite indexes, and
 * both the Pending/Running and old-completed sets are naturally small.
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

    // Phase 1: Mark Pending/Running jobs as Failed if they're old enough.
    const inFlightSnap = await db
      .collection(COLLECTIONS.transcriptionJobs)
      .where('status', 'in', ['Pending', 'Running'])
      .limit(SWEEP_BATCH_SIZE)
      .get();

    let failed = 0;
    let errored = 0;
    let skippedFresh = 0;

    for (const doc of inFlightSnap.docs) {
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

    // Phase 2: Delete terminal-state jobs older than the retention window.
    let pruned = 0;
    let prunedErrors = 0;
    let moreToDelete = true;

    while (moreToDelete) {
      const terminalSnap = await db
        .collection(COLLECTIONS.transcriptionJobs)
        .where('status', 'in', ['Completed', 'Failed'])
        .orderBy('status')
        .orderBy('completedAt')
        .limit(SWEEP_BATCH_SIZE)
        .get();

      if (terminalSnap.empty) {
        moreToDelete = false;
        break;
      }

      const writer = db.batch();
      let batchPruned = 0;

      for (const doc of terminalSnap.docs) {
        const completedAt = doc.get('completedAt') as Timestamp | null | undefined;
        if (isCompletedJobPrunable(completedAt, now)) {
          writer.delete(doc.ref);
          batchPruned += 1;
        }
      }

      // Only commit if we actually deleted something; an all-fresh batch
      // means we've hit the boundary of the retention window.
      if (batchPruned > 0) {
        try {
          await writer.commit();
          pruned += batchPruned;
        } catch (err) {
          prunedErrors += 1;
          logger.warn('sweepStaleTranscriptionJobs: batch delete failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // If this batch was smaller than our limit, we're done; or if we
      // didn't prune anything (all fresh), don't loop again.
      moreToDelete = terminalSnap.size === SWEEP_BATCH_SIZE && batchPruned > 0;
    }

    logger.info('sweepStaleTranscriptionJobs: complete', {
      inFlightScanned: inFlightSnap.size,
      inFlightFailed: failed,
      inFlightErrors: errored,
      inFlightSkippedFresh: skippedFresh,
      pruned,
      prunedErrors,
    });
  },
);
