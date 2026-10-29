import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, MAX_AUDIO_UPLOAD_BYTES, OBSERVATION_STATUS } from '@ops/shared';
import {
  DRIVE_SECRETS,
  DRIVE_SERVICE_ACCOUNT,
  ResumableUploadGoneError,
  deleteObservationFolder,
  ensureObservationFolder,
  getFileParents,
  isResumableSessionUrl,
  putResumableChunk,
  shareObservationFolderWithObservers,
  startResumableUpload,
  uploadFileToFolder,
  withdrawObservedFolderAccess,
} from '../lib/drive.js';
import { RATE_LIMIT_KEYS, checkRateLimit, loadRateLimits } from '../lib/rateLimit.js';
import { parseDurationSec, parseRecordedAt, parseUploadRequest } from './recordingHeaders.js';
import { observationAccessFor } from '@ops/shared';
import { isDemoEditSession, isDemoStaff } from '../lib/callable.js';

if (getApps().length === 0) initializeApp();

/** One hour, in milliseconds — the audioUploadsPerHour window. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Drive folder ID where per-observation subfolders live. Configured via
 * `firebase deploy` parameter prompt or `firebase functions:config:set`.
 * The Workspace admin (Paul) creates this folder once in Phase 0h, shares
 * it with the SA as Editor and admins as Reader.
 */
const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

/**
 * Accepts a raw audio blob in the request body and writes it to the
 * observation's Drive folder (creating the folder on first audio upload).
 *
 * Headers:
 *   Authorization: Bearer <Firebase ID token>
 *   X-Observation-Id: <observation doc ID>
 *   Content-Type: audio/webm | audio/mp4 | audio/ogg | application/octet-stream
 *   X-Audio-Duration-Sec: <seconds recorded> (optional, display metadata)
 *   X-Audio-Recorded-At: <ISO time recording started> (optional)
 *
 * Audio over 32 MiB (the Cloud Functions request limit; a class period
 * recorded in the browser easily passes it) comes in pieces of
 * AUDIO_UPLOAD_CHUNK_BYTES, forwarded to a Drive resumable upload:
 *   X-Upload-Total-Bytes: <size of the whole file>
 *   X-Upload-Offset: <byte this piece starts at>
 *   X-Upload-Session: <uploadSession from the previous response> (not on
 *     the first piece). An empty body asks where to resume.
 * Every piece but the last answers 200 { status: 'incomplete',
 * uploadSession, received }. Without these headers the body is the whole
 * file, as older clients send it.
 *
 * On success: 200 { audioFileId, fileName }
 *
 * The function appends the new fileId to `observation.audioDriveFileIds`
 * and writes its `audioRecordings` entry, so the editor's onSnapshot picks
 * it up and renders the new recording in the audio list. Transcription is
 * requested separately (see requestTranscription).
 */
export const uploadAudio = onRequest(
  {
    region: 'us-central1',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    secrets: DRIVE_SECRETS,
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
    let demoEdit = false;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      userEmail = decoded.email?.toLowerCase() ?? null;
      demoEdit = isDemoEditSession({ token: decoded });
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
    // rawBody is typed as always present, but the body parser never sets it
    // on an empty request, which a resumable status query is.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const body = req.rawBody ?? Buffer.alloc(0);
    const upload = parseUploadRequest(
      {
        total: req.header('x-upload-total-bytes'),
        offset: req.header('x-upload-offset'),
        session: req.header('x-upload-session'),
      },
      body.length,
      MAX_AUDIO_UPLOAD_BYTES,
    );
    if (upload.kind === 'invalid') {
      res.status(upload.status).send(upload.reason);
      return;
    }
    if (upload.kind === 'whole' && body.length === 0) {
      res.status(400).send('Empty body');
      return;
    }
    if (upload.kind === 'chunk' && upload.session && !isResumableSessionUrl(upload.session)) {
      res.status(400).send('Bad X-Upload-Session');
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
      coObserverEmails?: string[];
      observedName: string;
      status: string;
      driveFolderId: string | null;
      pdfDriveFileId?: string | null;
    };
    // The observers record: owner or co-observer.
    // A demo-edit session (View As + Edit) only records on demo staff.
    if (demoEdit && !(await isDemoStaff(db, obs.observedEmail))) {
      res.status(403).send('Only demo staff can be changed while editing as someone else');
      return;
    }
    const access = observationAccessFor(obs, userEmail, false);
    if (access !== 'owner' && access !== 'coObserver') {
      res.status(403).send('Not your observation');
      return;
    }
    if (obs.status !== OBSERVATION_STATUS.draft) {
      res.status(409).send('Observation is not in Draft state');
      return;
    }

    // Per-user rate limit: reject beyond audioUploadsPerHour before doing any
    // Drive work, so a runaway client can't fill the district folder or burn
    // SA quota. The counter only increments on an allowed request, and a
    // chunked upload counts once, on its first piece.
    const startsUpload = upload.kind === 'whole' || upload.session === null;
    if (startsUpload) {
      try {
        const limits = await loadRateLimits(db);
        const decision = await checkRateLimit(db, {
          userEmail,
          key: RATE_LIMIT_KEYS.audioUpload,
          max: limits.audioUploadsPerHour,
          windowMs: HOUR_MS,
        });
        if (!decision.allowed) {
          const retryAfterSec = Math.max(1, Math.ceil((decision.resetAtMs - Date.now()) / 1000));
          res.set('Retry-After', String(retryAfterSec));
          res
            .status(429)
            .send(`Audio upload limit reached (${String(limits.audioUploadsPerHour)}/hour).`);
          return;
        }
      } catch (err) {
        // Fail-open: a transient Firestore error on the limiter must not block a
        // legitimate upload (the observation/Draft guards still bound abuse).
        logger.warn('uploadAudio: rate-limit check failed (allowing)', err);
      }
    }

    try {
      let folderId = obs.driveFolderId;
      if (startsUpload) {
        const created = await ensureObservationFolder({
          observationId,
          observedName: obs.observedName,
          parentFolderId: PARENT_FOLDER_ID.value(),
          existingFolderId: obs.driveFolderId,
        });
        // A new folder (none yet, or the old one was trashed or outside the
        // parent): claim it in a transaction so two first uploads at once
        // end up in one folder, the one driveFolderId names. Playback only
        // serves recordings that sit in that folder.
        const ensured =
          created === obs.driveFolderId
            ? created
            : await db.runTransaction(async (tx) => {
                const snap = await tx.get(obsRef);
                const current = (snap.get('driveFolderId') as string | null | undefined) ?? null;
                if (current && current !== obs.driveFolderId) return current;
                tx.update(obsRef, { driveFolderId: created });
                return created;
              });
        if (ensured !== created) {
          try {
            await deleteObservationFolder({
              folderId: created,
              parentFolderId: PARENT_FOLDER_ID.value(),
            });
          } catch (err) {
            logger.warn('uploadAudio: duplicate folder cleanup failed', { folderId: created, err });
          }
        }
        // Best-effort Reader grant so the observer can play back recordings
        // from Drive (co-observers too); never fails the upload.
        await shareObservationFolderWithObservers({
          folderId: ensured,
          observerEmail: obs.observerEmail,
          coObserverEmails: obs.coObserverEmails,
        });
        // A reopened observation: take back the observed staff member's
        // finalize-time folder grant before adding a Draft recording it
        // would cover. Throws (no upload) if Drive can't confirm that.
        if (obs.pdfDriveFileId) {
          await withdrawObservedFolderAccess({
            folderId: ensured,
            parentFolderId: PARENT_FOLDER_ID.value(),
            observedEmail: obs.observedEmail,
            pdfDriveFileId: obs.pdfDriveFileId,
            observationId,
          });
        }
        folderId = ensured;
      }
      if (!folderId) {
        // A later piece, but the first piece's folder was never recorded.
        res.status(410).send('Upload session expired; start the upload again');
        return;
      }
      const ext = mimeTypeToExt(mimeType);
      const filename = `audio-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;

      let uploaded: { fileId: string; fileName: string };
      if (upload.kind === 'whole') {
        uploaded = await uploadFileToFolder({ folderId, filename, mimeType, body });
      } else {
        // The claim above already recorded the folder: later pieces check
        // the finished file landed in it, and read it from the observation.
        const sessionUrl =
          upload.session ??
          (await startResumableUpload({
            folderId,
            filename,
            mimeType,
            totalBytes: upload.totalBytes,
          }));
        const status = await putResumableChunk({
          sessionUrl,
          chunk: body,
          offset: upload.offset,
          totalBytes: upload.totalBytes,
        });
        if (!status.done) {
          res.json({ status: 'incomplete', uploadSession: sessionUrl, received: status.received });
          return;
        }
        // The session URL comes back from the browser, so make sure the
        // finished file is in this observation's folder before linking it.
        const parents = await getFileParents(status.fileId);
        if (!parents.includes(folderId)) {
          logger.warn('uploadAudio: finished file is not in the observation folder', {
            observationId,
            fileId: status.fileId,
          });
          res.status(403).send('Upload does not belong to this observation');
          return;
        }
        uploaded = { fileId: status.fileId, fileName: status.fileName };
      }
      const recordedAt = parseRecordedAt(req.header('x-audio-recorded-at'));

      await obsRef.update(
        'audioDriveFileIds',
        FieldValue.arrayUnion(uploaded.fileId),
        new FieldPath('audioRecordings', uploaded.fileId),
        {
          recordedAt: recordedAt ?? FieldValue.serverTimestamp(),
          durationSec: parseDurationSec(req.header('x-audio-duration-sec')),
          label: '',
        },
        'driveFolderId',
        folderId,
        'lastModifiedAt',
        FieldValue.serverTimestamp(),
      );

      res.json({
        audioFileId: uploaded.fileId,
        fileName: uploaded.fileName,
        driveFolderId: folderId,
      });
    } catch (err) {
      if (err instanceof ResumableUploadGoneError) {
        res.status(410).send('Upload session expired; start the upload again');
        return;
      }
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
