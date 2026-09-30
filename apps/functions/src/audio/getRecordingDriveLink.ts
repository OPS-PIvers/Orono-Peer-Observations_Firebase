import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recordingRefInput } from '@ops/shared';
import {
  DRIVE_SECRETS,
  DRIVE_SERVICE_ACCOUNT,
  getDriveLinks,
  shareWithUser,
} from '../lib/drive.js';
import {
  callerEmail,
  loadObservation,
  requireRecording,
  requireRecordingReader,
} from './recordingAccess.js';

if (getApps().length === 0) initializeApp();

/**
 * "View in Drive" for one recording: grants the caller Reader access on that
 * file only (on demand, not at upload) and returns its Drive `webViewLink`.
 * Open to the same people who can play the recording back through getAudio.
 */
export const getRecordingDriveLink = onCall(
  {
    region: 'us-central1',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    secrets: DRIVE_SECRETS,
    memory: '256MiB',
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
    requireRecording(obs, audioFileId);
    await requireRecordingReader(db, request, obs, email);

    try {
      await shareWithUser({
        fileId: audioFileId,
        email,
        role: 'reader',
        sendNotificationEmail: false,
      });
      const { webViewLink } = await getDriveLinks(audioFileId);
      return { webViewLink };
    } catch (err) {
      logger.error('getRecordingDriveLink: failed', { observationId, audioFileId, err });
      throw new HttpsError('internal', 'Could not open this recording in Drive');
    }
  },
);
