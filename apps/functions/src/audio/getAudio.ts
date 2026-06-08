import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, isAdminRole } from '@ops/shared';
import { downloadFile, getDriveClient } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

/**
 * Streams an audio file from Drive back to the client. The client uses
 * this in an `<audio>` tag for playback. The SA owns the file, and the
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
    let role: string | undefined;
    let hasSpecialAccess = false;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      userEmail = decoded.email?.toLowerCase() ?? null;
      role = decoded['role'] as string | undefined;
      hasSpecialAccess = decoded['hasSpecialAccess'] === true;
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
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) {
      res.status(404).send('Observation not found');
      return;
    }
    const obs = obsSnap.data() as {
      observerEmail: string;
      observedEmail: string;
      status: string;
      audioDriveFileIds: string[];
    };
    if (!obs.audioDriveFileIds.includes(audioFileId)) {
      res.status(404).send('Audio file is not part of this observation');
      return;
    }

    const isAdmin = isAdminRole(role ?? null) || hasSpecialAccess;
    const isObserver = obs.observerEmail === userEmail;
    const isObservedFinalized =
      obs.observedEmail === userEmail && obs.status === OBSERVATION_STATUS.finalized;
    if (!isAdmin && !isObserver && !isObservedFinalized) {
      res.status(403).send('Not authorized to access this audio');
      return;
    }

    try {
      const drive = getDriveClient();
      const meta = await drive.files.get({ fileId: audioFileId, fields: 'mimeType, name' });
      const buffer = await downloadFile(audioFileId);
      res.setHeader('Content-Type', meta.data.mimeType ?? 'audio/webm');
      res.setHeader('Content-Disposition', `inline; filename="${meta.data.name ?? 'audio.webm'}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.status(200).send(buffer);
    } catch (err) {
      logger.error('getAudio: failed', err);
      res.status(500).send('Failed to fetch audio');
    }
  },
);
