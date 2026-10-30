import { pipeline } from 'node:stream/promises';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { defineString } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';
import {
  DRIVE_SECRETS,
  DRIVE_SERVICE_ACCOUNT,
  ForeignDriveObjectError,
  assertFilesInObservationFolder,
  downloadFileStream,
  getDriveClient,
} from '../lib/drive.js';
import { canReadRecording } from './recordingAccess.js';
import { isArchivedCaller } from '../lib/callable.js';

if (getApps().length === 0) initializeApp();

const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

/**
 * Streams an audio file from Drive back to the client. The client uses
 * this in an `<audio>` tag for playback. The file lives in a private Drive folder, and the
 * client can't read it directly from Drive — we proxy the bytes through.
 *
 * GET /getAudio?observationId=<id>&audioFileId=<id>
 *   Authorization: Bearer <Firebase ID token>
 *
 * Authorization: caller must be the observer, an admin, or the observed
 * staff member (when the observation is finalized).
 */
export const getAudio = onRequest(
  {
    region: 'us-central1',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    secrets: DRIVE_SECRETS,
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method !== 'GET') {
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
    // The decoded token as an auth object, so canReadRecording applies the
    // same demo-edit confinement as the callables (this is onRequest, so the
    // onCall wrapper's default-deny doesn't cover it).
    let callerAuth: { token: Record<string, unknown> } | null = null;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      userEmail = decoded.email?.toLowerCase() ?? null;
      callerAuth = { token: decoded };
    } catch (err) {
      logger.warn('getAudio: invalid token', err);
      res.status(401).send('Invalid token');
      return;
    }
    if (!userEmail) {
      res.status(401).send('Token has no email');
      return;
    }

    const observationIdRaw = req.query['observationId'];
    const audioFileIdRaw = req.query['audioFileId'];
    const observationId = typeof observationIdRaw === 'string' ? observationIdRaw : '';
    const audioFileId = typeof audioFileIdRaw === 'string' ? audioFileIdRaw : '';
    if (!observationId || !audioFileId) {
      res.status(400).send('Missing observationId or audioFileId');
      return;
    }

    const db = getFirestore();
    // onRequest, so the onCall wrapper's archived-staff refusal doesn't run.
    if (await isArchivedCaller(db, callerAuth)) {
      res.status(403).send('Your staff account is archived');
      return;
    }
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) {
      res.status(404).send('Observation not found');
      return;
    }
    const obs = obsSnap.data() as {
      observerEmail: string;
      observedEmail: string;
      coObserverEmails?: string[];
      status: string;
      audioDriveFileIds: string[];
      driveFolderId?: string | null;
    };
    if (!obs.audioDriveFileIds.includes(audioFileId)) {
      res.status(404).send('Audio file is not part of this observation');
      return;
    }

    // Observers (owner or co-observer), oversight, or the observed staff
    // member once finalized. Other PEs and building Administrators can't.
    if (!(await canReadRecording(db, obs, userEmail, callerAuth))) {
      res.status(403).send('Not authorized to access this audio');
      return;
    }

    try {
      // The id must name a file in this observation's own folder: the Drive
      // token can read far more than the observations tree.
      await assertFilesInObservationFolder({
        fileIds: [audioFileId],
        folderId: obs.driveFolderId,
        parentFolderId: PARENT_FOLDER_ID.value(),
        observationId,
      });
      const drive = await getDriveClient();
      const meta = await drive.files.get({
        fileId: audioFileId,
        fields: 'mimeType, name',
        supportsAllDrives: true,
      });
      const audio = await downloadFileStream(audioFileId);
      res.setHeader('Content-Type', meta.data.mimeType ?? 'audio/webm');
      res.setHeader('Content-Disposition', `inline; filename="${meta.data.name ?? 'audio.webm'}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.status(200);
      // Streamed with no Content-Length, so the response goes out chunked:
      // Cloud Functions refuse a buffered response over 32 MiB, which a
      // class-period recording is.
      await pipeline(audio, res);
    } catch (err) {
      if (err instanceof ForeignDriveObjectError) {
        res.status(404).send('Audio file is not part of this observation');
        return;
      }
      logger.error('getAudio: failed', err);
      if (res.headersSent) res.destroy();
      else res.status(500).send('Failed to fetch audio');
    }
  },
);
