import { Timestamp } from 'firebase/firestore';
import type { TranscriptionJob } from '@ops/shared';

/**
 * Pure helpers for deriving per-recording transcription state from a flat
 * list of `/transcriptionJobs` docs. Split out from `useTranscriptionJobs`
 * so they can be unit tested without pulling in the Firebase app
 * initialization (`@/lib/firebase`) that the hook's Firestore subscription
 * depends on.
 */

/** Raw Firestore reads yield `Timestamp` instances for server-timestamp
 *  fields even though the shared zod schema types `createdAt` as an ISO
 *  string (that coercion only applies at the callable/API boundary). */
export function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
}

/** Reduces a flat list of job docs (possibly several per audio file, e.g.
 *  an original attempt plus a re-transcribe) down to the most recent job
 *  per `audioDriveFileId`, which is what the UI should reflect. */
export function groupLatestJobsByAudioFileId(
  jobs: (TranscriptionJob & { id: string })[],
): Record<string, TranscriptionJob & { id: string }> {
  const result: Record<string, TranscriptionJob & { id: string }> = {};
  for (const job of jobs) {
    const existing = result[job.audioDriveFileId];
    if (!existing || toMillis(job.createdAt) >= toMillis(existing.createdAt)) {
      result[job.audioDriveFileId] = job;
    }
  }
  return result;
}
