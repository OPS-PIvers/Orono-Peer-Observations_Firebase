import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { logger } from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordingRefInput } from '@ops/shared';
import {
  DRIVE_SECRETS,
  DRIVE_SERVICE_ACCOUNT,
  ForeignDriveObjectError,
  assertFilesInObservationFolder,
  getDriveLinks,
  shareWithUser,
} from '../lib/drive.js';
import {
  callerEmail,
  loadObservation,
  requireRecording,
  requireRecordingReader,
} from './recordingAccess.js';
import { assertDemoEditTarget } from '../lib/callable.js';
import { GOOGLEAPIS_MEMORY } from '../lib/memory.js';

if (getApps().length === 0) initializeApp();

const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

/**
 * "View in Drive" for one recording: grants the caller Reader access on that
 * file only (on demand, not at upload) and returns its Drive `webViewLink`.
 * Open to the same people who can play the recording back through getAudio.
 */
export const getRecordingDriveLink = onCall(
  {
    // Demo-edit sessions allowed; confined to demo staff below.
    allowDemoEdit: true,
    // requireRecordingReader does the archived check: archived observers
    // are refused, an archived teacher keeps their own finalized recordings.
    allowArchived: true,
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
    const { obs } = await loadObservation(db, observationId);
    await assertDemoEditTarget(db, request.auth, obs.observedEmail);
    requireRecording(obs, audioFileId);
    await requireRecordingReader(db, request, obs, email);

    try {
      await assertFilesInObservationFolder({
        fileIds: [audioFileId],
        folderId: obs.driveFolderId,
        parentFolderId: PARENT_FOLDER_ID.value(),
        observationId,
      });
      await shareWithUser({
        fileId: audioFileId,
        email,
        role: 'reader',
        sendNotificationEmail: false,
      });
      const { webViewLink } = await getDriveLinks(audioFileId);
      return { webViewLink };
    } catch (err) {
      if (err instanceof ForeignDriveObjectError) {
        throw new HttpsError('not-found', 'Recording not found on this observation');
      }
      logger.error('getRecordingDriveLink: failed', { observationId, audioFileId, err });
      throw new HttpsError('internal', 'Could not open this recording in Drive');
    }
  },
);
