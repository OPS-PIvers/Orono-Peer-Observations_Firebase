import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';
import {
  ensureObservationFolder,
  shareObservationFolderWithObserver,
  uploadFileToFolder,
} from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

/**
 * Drive folder ID where per-observation subfolders live. Configured via
 * `firebase deploy` parameter prompt or `firebase functions:config:set`.
 * The Workspace admin (Paul) creates this folder once in Phase 0h, shares
 * it with the SA as Editor and admins as Reader.
 */
const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

/**
 * Hard upper bound on an uploaded audio body. Without it an authenticated
 * observer could POST an arbitrarily large payload and OOM the 512MiB / 300s
 * function or stuff Drive with junk. Sized to the Cloud Run HTTP request limit
 * (~32 MiB) — audio recordings are inherently larger than the evidence-file
 * uploads (capped at 20 MB), and anything above the platform limit is already
 * rejected at ingress, so this bounds the body without regressing a legitimate
 * full-length recording.
 */
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

/**
 * Accepts a raw audio blob in the request body and writes it to the
 * observation's Drive folder (creating the folder on first audio upload).
 *
 * Headers:
 *   Authorization: Bearer <Firebase ID token>
 *   X-Observation-Id: <observation doc ID>
 *   Content-Type: audio/webm | audio/mp4 | audio/ogg | application/octet-stream
 *
 * On success: 200 { audioFileId, fileName }
 *
 * The function appends the new fileId to `observation.audioDriveFileIds`
 * so the editor's onSnapshot picks it up and renders the new recording in
 * the audio list. Transcription is requested separately (see
 * requestTranscription).
 */
export const uploadAudio = onRequest(
  {
    region: 'us-central1',
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const authHeader = req.header('authorization') ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      res.status(401).send('Missing Authorization header');
      return;
    }
    let userEmail: string | null = null;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      userEmail = decoded.email?.toLowerCase() ?? null;
    } catch (err) {
      logger.warn('uploadAudio: invalid token', err);
      res.status(401).send('Invalid token');
      return;
    }
    if (!userEmail) {
      res.status(401).send('Token has no email');
      return;
    }

    const observationId = req.header('x-observation-id');
    if (!observationId) {
      res.status(400).send('Missing X-Observation-Id header');
      return;
    }

    const mimeType = req.header('x-audio-mime-type') ?? req.header('content-type') ?? 'audio/webm';
    const body = req.rawBody;
    if (body.length === 0) {
      res.status(400).send('Empty body');
      return;
    }
    if (body.length > MAX_AUDIO_BYTES) {
      res.status(413).send('Audio file too large');
      return;
    }

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) {
      res.status(404).send('Observation not found');
      return;
    }
    const obs = obsSnap.data() as {
      observerEmail: string;
      observedName: string;
      status: string;
      driveFolderId: string | null;
    };
    if (obs.observerEmail !== userEmail) {
      res.status(403).send('Not your observation');
      return;
    }
    if (obs.status !== OBSERVATION_STATUS.draft) {
      res.status(409).send('Observation is not in Draft state');
      return;
    }

    try {
      const folderId = await ensureObservationFolder({
        observationId,
        observedName: obs.observedName,
        parentFolderId: PARENT_FOLDER_ID.value(),
        existingFolderId: obs.driveFolderId,
      });
      // Grant the observer Reader on the folder so the recordings they see
      // in the editor actually open (the parent folder is shared only with
      // admins + the service account). Idempotent and non-fatal.
      await shareObservationFolderWithObserver({
        folderId,
        observerEmail: obs.observerEmail,
      });
      const ext = mimeTypeToExt(mimeType);
      const filename = `audio-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
      const uploaded = await uploadFileToFolder({ folderId, filename, mimeType, body });

      await obsRef.update({
        audioDriveFileIds: FieldValue.arrayUnion(uploaded.fileId),
        driveFolderId: folderId,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });

      res.json({
        audioFileId: uploaded.fileId,
        fileName: uploaded.fileName,
        driveFolderId: folderId,
      });
    } catch (err) {
      logger.error('uploadAudio: failed', err);
      res.status(500).send('Upload failed');
    }
  },
);

function mimeTypeToExt(mimeType: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}
