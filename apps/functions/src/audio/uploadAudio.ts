import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, parseAudioRecordedAt } from '@ops/shared';
import {
  ensureObservationFolder,
  shareObservationFolderWithObserver,
  uploadFileToFolder,
} from '../lib/drive.js';
import { RATE_LIMIT_KEYS, checkRateLimit, loadRateLimits } from '../lib/rateLimit.js';

if (getApps().length === 0) initializeApp();

/** One hour, in milliseconds — the audioUploadsPerHour enforcement window. */
const HOUR_MS = 60 * 60 * 1000;

/** Allowed audio MIME types that clients may upload. */
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
]);

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
 * Normalize a client-supplied MIME type by stripping codec parameters.
 * E.g., 'audio/webm;codecs=opus' -> 'audio/webm'.
 * Exported for unit testing.
 */
export function normalizeMimeType(mimeType: string): string {
  const parts = mimeType.split(';');
  return (parts[0] ?? '').toLowerCase().trim();
}

class InvalidAudioMimeTypeError extends Error {
  statusCode = 415;
}

/**
 * Validate and normalize the declared MIME type against the allowlist.
 * Returns the normalized MIME type on success; throws an error with
 * HTTP status code if the MIME type is unsupported.
 * Exported for unit testing.
 */
export function validateAudioMimeType(mimeType: string): string {
  const normalized = normalizeMimeType(mimeType);
  if (!ALLOWED_AUDIO_MIMES.has(normalized)) {
    throw new InvalidAudioMimeTypeError(`Unsupported audio MIME type: ${mimeType}`);
  }
  return normalized;
}

/**
 * Check magic bytes of the audio buffer to verify it matches the declared MIME type.
 * Returns true if the buffer appears to match the MIME type, false if it's
 * clearly mismatched. Inconclusive buffers (too short) return true (permissive).
 * Exported for unit testing.
 */
export function sniffAudioMimeType(mimeType: string, buffer: Buffer): boolean {
  // Need at least 4 bytes for magic byte checks
  if (buffer.length < 4) {
    return true; // Inconclusive; allow
  }

  const normalized = normalizeMimeType(mimeType);

  if (normalized === 'audio/webm') {
    // EBML signature: 0x1A 0x45 0xDF 0xA3
    return buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }

  if (normalized === 'audio/mp4') {
    // MP4 has 'ftyp' at offset 4 (signature at 0 is size, typically 0x00000020)
    // Accept if we have 'ftyp' within the first 12 bytes
    if (buffer.length >= 8) {
      const bytesAtOffset4 = buffer.toString('ascii', 4, 8);
      return bytesAtOffset4 === 'ftyp';
    }
    return true; // Inconclusive
  }

  if (normalized === 'audio/ogg') {
    // Ogg Vorbis/Opus starts with 'OggS'
    return buffer.toString('ascii', 0, 4) === 'OggS';
  }

  if (normalized === 'audio/wav') {
    // RIFF at offset 0, WAVE at offset 8
    if (buffer.length >= 12) {
      const header = buffer.toString('ascii', 0, 4);
      const format = buffer.toString('ascii', 8, 12);
      return header === 'RIFF' && format === 'WAVE';
    }
    return true; // Inconclusive
  }

  if (normalized === 'audio/mpeg') {
    // MP3 typically starts with 0xFF 0xFB or 0xFF 0xFA (frame sync)
    // or with 'ID3' for ID3v2 tags
    const firstByte = buffer[0];
    const secondByte = buffer[1];
    return (
      (firstByte === 0xff && secondByte !== undefined && (secondByte & 0xe0) === 0xe0) ||
      (buffer.length >= 3 && buffer.toString('ascii', 0, 3) === 'ID3')
    );
  }

  return true; // Unknown MIME type; be permissive
}

/**
 * Accepts a raw audio blob in the request body and writes it to the
 * observation's Drive folder (creating the folder on first audio upload).
 *
 * Headers:
 *   Authorization: Bearer <Firebase ID token>
 *   X-Observation-Id: <observation doc ID>
 *   X-Audio-Mime-Type: audio/webm | audio/mp4 | audio/ogg | audio/mpeg | audio/wav
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

    const declaredMimeType = req.header('x-audio-mime-type') ?? req.header('content-type');
    if (!declaredMimeType) {
      res.status(400).send('Missing X-Audio-Mime-Type or Content-Type header');
      return;
    }

    let mimeType: string;
    try {
      mimeType = validateAudioMimeType(declaredMimeType);
    } catch (err) {
      if (err instanceof InvalidAudioMimeTypeError) {
        res.status(415).send(`Invalid audio MIME type: ${declaredMimeType}`);
      } else {
        res.status(400).send(`Invalid audio MIME type: ${declaredMimeType}`);
      }
      return;
    }

    const body = req.rawBody;
    if (body.length === 0) {
      res.status(400).send('Empty body');
      return;
    }
    if (body.length > MAX_AUDIO_BYTES) {
      res.status(413).send('Audio file too large');
      return;
    }

    // Sniff magic bytes as defense-in-depth: reject obvious mismatches
    if (!sniffAudioMimeType(mimeType, body)) {
      logger.warn('uploadAudio: MIME type mismatch detected via sniffing', {
        declaredMimeType: mimeType,
        bodyStart: body.subarray(0, 8).toString('hex'),
      });
      res.status(415).send('Audio content does not match declared MIME type');
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

    // Per-user rate limit: reject beyond audioUploadsPerHour before doing any
    // Drive work, so a runaway client can't fill the district folder or burn
    // SA quota. The counter only increments on an allowed request.
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
      // legitimate upload (the MAX_AUDIO_BYTES cap still bounds abuse).
      logger.warn('uploadAudio: rate-limit check failed (allowing)', err);
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
      const recordedAt = new Date();
      const filename = audioFileName(mimeType, recordedAt);
      const uploaded = await uploadFileToFolder({ folderId, filename, mimeType, body });

      await obsRef.update({
        audioDriveFileIds: FieldValue.arrayUnion(uploaded.fileId),
        driveFolderId: folderId,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });

      // Surface the recording instant the filename encodes so the recorder can
      // label the new row immediately, without a round-trip to getAudio.
      const parsedRecordedAt = parseAudioRecordedAt(uploaded.fileName) ?? recordedAt;
      res.json({
        audioFileId: uploaded.fileId,
        fileName: uploaded.fileName,
        driveFolderId: folderId,
        recordedAt: parsedRecordedAt.toISOString(),
      });
    } catch (err) {
      logger.error('uploadAudio: failed', err);
      res.status(500).send('Upload failed');
    }
  },
);

export function mimeTypeToExt(mimeType: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

/**
 * Mint the Drive filename for a recording: `audio-<iso>.<ext>` where `<iso>`
 * is `recordedAt.toISOString()` truncated to whole seconds with `:`/`.` swapped
 * for `-` (e.g. `audio-2026-06-10T14-30-45.webm`). The timestamp is recoverable
 * via `parseAudioRecordedAt` in `@ops/shared`, which the recorder uses to label
 * each recording with its date/time. Exported for unit testing.
 */
export function audioFileName(mimeType: string, recordedAt: Date): string {
  const stamp = recordedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `audio-${stamp}.${mimeTypeToExt(mimeType)}`;
}
