import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';

if (getApps().length === 0) initializeApp();

interface RequestData {
  observationId?: string;
  audioFileId?: string;
}

/**
 * Callable function the client invokes when the user clicks "Transcribe"
 * on a recorded audio. Creates a `/transcriptionJobs/{jobId}` doc with
 * status='Pending'; the Firestore-triggered worker picks it up and runs
 * the Gemini call asynchronously. Returns the job ID so the client can
 * subscribe with `onSnapshot` for live progress.
 *
 * Idempotency: if a Pending or Running job already exists for this
 * (observationId, audioFileId) the existing jobId is returned instead of
 * creating a duplicate. Completed jobs do NOT block re-requesting — the
 * user might want to re-transcribe after editing.
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

    // Look for an in-flight job for the same audio.
    const inflight = await db
      .collection(COLLECTIONS.transcriptionJobs)
      .where('observationId', '==', observationId)
      .where('audioDriveFileId', '==', audioFileId)
      .where('status', 'in', ['Pending', 'Running'])
      .limit(1)
      .get();
    if (!inflight.empty) {
      const existing = inflight.docs[0];
      logger.info('requestTranscription: returning existing in-flight job', {
        jobId: existing?.id,
      });
      return { jobId: existing?.id };
    }

    const jobRef = db.collection(COLLECTIONS.transcriptionJobs).doc();
    await jobRef.set({
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
    return { jobId: jobRef.id };
  },
);
