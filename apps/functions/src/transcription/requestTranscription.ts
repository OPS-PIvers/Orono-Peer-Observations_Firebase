import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Timestamp } from 'firebase-admin/firestore';
import { APP_SETTINGS_DOC_ID, COLLECTIONS } from '@ops/shared';
import { isStaleTranscriptionJob } from './sweepStaleTranscriptionJobs.js';

if (getApps().length === 0) initializeApp();

interface RequestData {
  observationId?: string;
  audioFileId?: string;
}

/**
 * How many in-flight candidates to inspect when deduping. Stale dead jobs can
 * accumulate between hourly sweeps (one per click), so look past the first
 * match. No orderBy — adding one to the `in` + equality query would require a
 * composite index, and the in-flight set per audio file is tiny.
 */
const INFLIGHT_LOOKBACK_LIMIT = 10;

/**
 * Callable function the client invokes when the user clicks "Transcribe"
 * on a recorded audio. Creates a `/transcriptionJobs/{jobId}` doc with
 * status='Pending'; the Firestore-triggered worker picks it up and runs
 * the Gemini call asynchronously. Returns the job ID so the client can
 * subscribe with `onSnapshot` for live progress.
 *
 * Idempotency: if a *fresh* Pending or Running job already exists for this
 * (observationId, audioFileId) the existing jobId is returned instead of
 * creating a duplicate. Jobs older than the stale threshold are ignored —
 * their worker is dead (the hourly sweepStaleTranscriptionJobs will mark
 * them Failed) and they must not block re-transcription. Completed jobs do
 * NOT block re-requesting — the user might want to re-transcribe after
 * editing. The check + create run inside a transaction so two rapid
 * requests can't double-create.
 */
export const requestTranscription = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) {
      throw new HttpsError('unauthenticated', 'Token has no email');
    }

    const data = (request.data ?? {}) as RequestData;
    const { observationId, audioFileId } = data;
    if (!observationId || !audioFileId) {
      throw new HttpsError('invalid-argument', 'observationId and audioFileId required');
    }

    const db = getFirestore();
    const settingsSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
    // Firestore reads return raw doc data; the Zod defaults in AppSettings
    // are only applied during parse. Treat the whole tree as optional so a
    // partially-populated doc doesn't crash this guard.
    const settings = settingsSnap.exists
      ? (settingsSnap.data() as { gemini?: { audioTranscription?: { enabled?: boolean } } })
      : null;
    if (settings?.gemini?.audioTranscription?.enabled === false) {
      throw new HttpsError(
        'failed-precondition',
        'Audio transcription is currently disabled by an admin.',
      );
    }

    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) {
      throw new HttpsError('not-found', 'Observation not found');
    }
    const obs = obsSnap.data() as { observerEmail: string; audioDriveFileIds: string[] };
    if (obs.observerEmail !== userEmail) {
      throw new HttpsError('permission-denied', 'Not your observation');
    }
    if (!obs.audioDriveFileIds.includes(audioFileId)) {
      throw new HttpsError('not-found', 'Audio file is not part of this observation');
    }

    // Look for a fresh in-flight job for the same audio. Stale ones (worker
    // died; sweep hasn't failed them yet) are ignored so they can't block
    // re-transcription forever. Query + create share a transaction so two
    // rapid requests can't both pass the empty check and double-create.
    const jobsCol = db.collection(COLLECTIONS.transcriptionJobs);
    const inflightQuery = jobsCol
      .where('observationId', '==', observationId)
      .where('audioDriveFileId', '==', audioFileId)
      .where('status', 'in', ['Pending', 'Running'])
      .limit(INFLIGHT_LOOKBACK_LIMIT);

    const now = Date.now();
    const result = await db.runTransaction(async (tx) => {
      const inflight = await tx.get(inflightQuery);
      const fresh = inflight.docs.find(
        (doc) =>
          !isStaleTranscriptionJob(doc.get('createdAt') as Timestamp | null | undefined, now),
      );
      if (fresh) {
        return { jobId: fresh.id, reused: true };
      }
      const jobRef = jobsCol.doc();
      tx.set(jobRef, {
        jobId: jobRef.id,
        observationId,
        audioDriveFileId: audioFileId,
        requestedBy: userEmail,
        status: 'Pending',
        startedAt: null,
        completedAt: null,
        error: null,
        transcriptPreview: null,
        geminiFileUri: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { jobId: jobRef.id, reused: false };
    });

    if (result.reused) {
      logger.info('requestTranscription: returning existing in-flight job', {
        jobId: result.jobId,
      });
    }
    return { jobId: result.jobId };
  },
);
