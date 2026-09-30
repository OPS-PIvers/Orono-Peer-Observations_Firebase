import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { backfillRecordingMetadataInput, type AudioRecordingMeta } from '@ops/shared';
import { DRIVE_SECRETS, DRIVE_SERVICE_ACCOUNT } from '../lib/drive.js';
import {
  callerEmail,
  loadObservation,
  recordingMetaFromDrive,
  requireRecording,
  requireRecordingReader,
} from './recordingAccess.js';

if (getApps().length === 0) initializeApp();

/**
 * Fill `audioRecordings` entries for an observation's recordings that don't
 * have one — recordings uploaded before per-recording metadata existed. The
 * recordings list calls this once when it sees a gap; `recordedAt` comes from
 * the Drive file's createdTime and the duration stays unknown. Only missing
 * entries are written, so a label set meanwhile is never overwritten. A
 * recording whose Drive lookup fails is skipped and retried on a later call.
 */
export const backfillRecordingMetadata = onCall(
  {
    region: 'us-central1',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    secrets: DRIVE_SECRETS,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    const email = callerEmail(request);
    const parsed = backfillRecordingMetadataInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { observationId } = parsed.data;

    const db = getFirestore();
    const { ref, obs } = await loadObservation(db, observationId);
    await requireRecordingReader(db, request, obs, email);

    const missing = (obs.audioDriveFileIds ?? []).filter((id) => !obs.audioRecordings?.[id]);
    if (missing.length === 0) return { filled: 0 };

    const filled: [string, AudioRecordingMeta][] = [];
    for (const audioFileId of missing) {
      try {
        requireRecording(obs, audioFileId);
        filled.push([audioFileId, await recordingMetaFromDrive(audioFileId)]);
      } catch (err) {
        logger.warn('backfillRecordingMetadata: skipped a recording', {
          observationId,
          audioFileId,
          err,
        });
      }
    }
    if (filled.length === 0) return { filled: 0 };

    // Re-check inside a transaction so an entry written meanwhile (a rename,
    // a concurrent backfill) wins over the Drive-derived default.
    const written = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = (snap.data()?.['audioRecordings'] ?? {}) as Record<string, unknown>;
      const ids = (snap.data()?.['audioDriveFileIds'] ?? []) as string[];
      const toWrite = filled.filter(([id]) => ids.includes(id) && !current[id]);
      if (toWrite.length === 0) return 0;
      // A merge set adds entries to the map without touching the others.
      tx.set(ref, { audioRecordings: Object.fromEntries(toWrite) }, { merge: true });
      return toWrite.length;
    });

    return { filled: written };
  },
);
