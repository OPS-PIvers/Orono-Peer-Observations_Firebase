import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { logger } from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { AUDIT_ACTIONS, COLLECTIONS, recordingRefInput } from '@ops/shared';
import {
  DRIVE_SECRETS,
  DRIVE_SERVICE_ACCOUNT,
  filesInObservationFolder,
  trashDriveFile,
} from '../lib/drive.js';
import {
  callerEmail,
  loadObservation,
  requireObserverOnDraft,
  requireRecording,
} from './recordingAccess.js';
import { assertDemoEditTarget } from '../lib/callable.js';
import { GOOGLEAPIS_MEMORY } from '../lib/memory.js';

if (getApps().length === 0) initializeApp();

const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

/**
 * Delete one audio recording from a Draft observation (observer only).
 * Modeled on removeEvidenceFile: first drop the recording from the
 * observation — its id, display metadata and transcript — then best-effort
 * move the Drive file to the trash, where it stays recoverable for ~30 days.
 * A failed trash doesn't undo the removal; the file just needs cleanup in
 * Drive.
 */
export const removeRecording = onCall(
  {
    // Demo-edit sessions allowed; confined to demo staff below.
    allowDemoEdit: true,
    region: 'us-central1',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    secrets: DRIVE_SECRETS,
    memory: GOOGLEAPIS_MEMORY,
    timeoutSeconds: 60,
  },
  async (request) => {
    const email = callerEmail(request);
    const parsed = recordingRefInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { observationId, audioFileId } = parsed.data;

    const db = getFirestore();
    const { ref, obs } = await loadObservation(db, observationId);
    await assertDemoEditTarget(db, request.auth, obs.observedEmail);
    requireRecording(obs, audioFileId);
    requireObserverOnDraft(obs, email);

    await ref.update(
      'audioDriveFileIds',
      FieldValue.arrayRemove(audioFileId),
      new FieldPath('audioRecordings', audioFileId),
      FieldValue.delete(),
      new FieldPath('transcripts', audioFileId),
      FieldValue.delete(),
      'lastModifiedAt',
      FieldValue.serverTimestamp(),
    );

    try {
      // Only a file in this observation's own folder is trashed.
      const inFolder = await filesInObservationFolder({
        fileIds: [audioFileId],
        folderId: obs.driveFolderId,
        parentFolderId: PARENT_FOLDER_ID.value(),
        observationId,
      });
      if (inFolder.includes(audioFileId)) await trashDriveFile(audioFileId);
    } catch (err) {
      logger.warn('removeRecording: Drive trash failed, recording still removed', {
        observationId,
        audioFileId,
        err,
      });
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail: email,
      action: AUDIT_ACTIONS.recordingRemoved,
      target: `${COLLECTIONS.observations}/${observationId}`,
      details: {
        audioFileId,
        label: obs.audioRecordings?.[audioFileId]?.label ?? '',
        observedEmail: obs.observedEmail,
      },
    });

    return { ok: true };
  },
);
