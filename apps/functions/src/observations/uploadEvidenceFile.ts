import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  isAdminRole,
  type Observation,
  type Staff,
} from '@ops/shared';
import {
  ensureObservationFolder,
  getDriveClient,
  shareObservationFolderWithObserver,
  uploadFileToFolder,
} from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

interface UploadEvidenceRequest {
  observationId?: string;
  componentId?: string;
  fileName?: string;
  mimeType?: string;
  base64Data?: string;
}

/**
 * MIME types accepted as observation evidence. Restricted to formats
 * teachers and admins are likely to need so a malicious uploader can't
 * stage executables or scripts in the observed staff member's Drive
 * folder.
 */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Plain text / data
  'text/plain',
  'text/csv',
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  // Audio (links to audio recording flow)
  'audio/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

export const uploadEvidenceFile = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId, componentId, fileName, mimeType, base64Data } = (request.data ??
      {}) as UploadEvidenceRequest;

    if (!observationId || !componentId || !fileName || !mimeType || !base64Data) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new HttpsError('invalid-argument', `Unsupported file type: ${mimeType}`);
    }

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) throw new HttpsError('not-found', 'Observation not found');

    const obs = obsSnap.data() as unknown as Observation;

    // Derive admin status from the live staff doc rather than the cached
    // ID token. ID tokens live ~1 hour, so a user who lost admin access
    // in the last hour would otherwise still pass the check.
    const staffSnap = await db.doc(`${COLLECTIONS.staff}/${userEmail}`).get();
    const staff = staffSnap.exists ? (staffSnap.data() as Staff) : null;
    const isAdmin = !!staff && (isAdminRole(staff.role) || staff.hasAdminAccess);

    if (!isAdmin && obs.observerEmail !== userEmail) {
      throw new HttpsError('permission-denied', 'Only the observer or admin can upload evidence');
    }
    if (obs.status !== OBSERVATION_STATUS.draft) {
      throw new HttpsError(
        'failed-precondition',
        'Cannot upload evidence to a finalized observation',
      );
    }

    // Validate file size (base64 → ~75% of byte count; limit 20 MB raw)
    const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
    if (estimatedBytes > 20 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'File exceeds 20 MB limit');
    }

    // Ensure the Drive folder exists (may be first evidence upload for this obs)
    const folderId = await ensureObservationFolder({
      observationId,
      observedName: obs.observedName,
      parentFolderId: PARENT_FOLDER_ID.value(),
      existingFolderId: obs.driveFolderId ?? null,
    });

    // If we just created the folder, persist it back to Firestore
    if (folderId !== obs.driveFolderId) {
      await obsRef.update({
        driveFolderId: folderId,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
    }

    // Grant the observer Reader on the folder so the evidence chips they
    // see in the editor actually open (the parent folder is shared only
    // with admins + the service account). Idempotent and non-fatal.
    await shareObservationFolderWithObserver({
      folderId,
      observerEmail: obs.observerEmail,
    });

    // Upload file to Drive
    const buffer = Buffer.from(base64Data, 'base64');
    const { fileId } = await uploadFileToFolder({
      folderId,
      filename: fileName,
      mimeType,
      body: buffer,
    });

    // Build driveFileRef. `uploadedAt` is a client-side Date because
    // Firestore doesn't allow `serverTimestamp()` inside arrayUnion
    // operands; the surrounding `lastModifiedAt` field captures the
    // authoritative server time.
    const fileRef = {
      driveFileId: fileId,
      name: fileName,
      mimeType,
      uploadedAt: new Date(),
      uploadedBy: userEmail,
    };

    // Append to evidenceLinks[componentId] atomically. If this fails
    // after the Drive upload succeeded, best-effort delete the orphan
    // so it doesn't pile up in the parent folder.
    try {
      await obsRef.update({
        [`evidenceLinks.${componentId}`]: FieldValue.arrayUnion(fileRef),
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      try {
        await getDriveClient().files.delete({ fileId });
      } catch (cleanupErr) {
        logger.warn('uploadEvidenceFile: orphan cleanup failed', { fileId, cleanupErr });
      }
      throw err;
    }

    return { driveFileId: fileId, name: fileName };
  },
);
