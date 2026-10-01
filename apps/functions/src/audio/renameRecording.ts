import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { renameRecordingInput } from '@ops/shared';
import { DRIVE_SECRETS, DRIVE_SERVICE_ACCOUNT } from '../lib/drive.js';
import {
  callerEmail,
  loadObservation,
  recordingMetaFromDrive,
  requireObserverOnDraft,
  requireRecording,
} from './recordingAccess.js';
import { assertDemoEditTarget } from '../lib/callable.js';

if (getApps().length === 0) initializeApp();

/**
 * Set (or clear, with an empty string) the display label of one recording on
 * a Draft observation (observer only). The Drive file keeps its name; the
 * label lives in `audioRecordings[audioFileId].label`. A recording made
 * before that map existed gets its full entry created here, with the Drive
 * createdTime as `recordedAt`.
 */
export const renameRecording = onCall(
  {
    // Demo-edit sessions allowed; confined to demo staff below.
    allowDemoEdit: true,
    region: 'us-central1',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    secrets: DRIVE_SECRETS,
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    const email = callerEmail(request);
    const parsed = renameRecordingInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { observationId, audioFileId, label } = parsed.data;

    const db = getFirestore();
    const { ref, obs } = await loadObservation(db, observationId);
    await assertDemoEditTarget(db, request.auth, obs.observedEmail);
    requireRecording(obs, audioFileId);
    requireObserverOnDraft(obs, email);

    const existing = obs.audioRecordings?.[audioFileId];
    const meta = existing ?? (await recordingMetaFromDrive(audioFileId));
    await ref.update(
      new FieldPath('audioRecordings', audioFileId),
      { ...meta, label },
      'lastModifiedAt',
      FieldValue.serverTimestamp(),
    );

    return { ok: true };
  },
);
