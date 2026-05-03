import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, isAdminRole, type Observation } from '@ops/shared';
import { ensureObservationFolder, uploadFileToFolder } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

interface UploadEvidenceRequest {
  observationId?: string;
  componentId?: string;
  fileName?: string;
  mimeType?: string;
  base64Data?: string;
}

export const uploadEvidenceFile = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId, componentId, fileName, mimeType, base64Data } =
      (request.data ?? {}) as UploadEvidenceRequest;

    if (!observationId || !componentId || !fileName || !mimeType || !base64Data) {
      throw new HttpsError('invalid-argument', 'Missing required fields');
    }

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) throw new HttpsError('not-found', 'Observation not found');

    const obs = obsSnap.data() as unknown as Observation;
    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);

    if (!isAdmin && obs.observerEmail !== userEmail) {
      throw new HttpsError('permission-denied', 'Only the observer or admin can upload evidence');
    }
    if (obs.status !== 'Draft') {
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
      await obsRef.update({ driveFolderId: folderId, lastModifiedAt: FieldValue.serverTimestamp() });
    }

    // Upload file to Drive
    const buffer = Buffer.from(base64Data, 'base64');
    const { fileId } = await uploadFileToFolder({
      folderId,
      filename: fileName,
      mimeType,
      body: buffer,
    });

    // Build driveFileRef
    const fileRef = {
      driveFileId: fileId,
      name: fileName,
      mimeType,
      uploadedAt: new Date().toISOString(),
      uploadedBy: userEmail,
    };

    // Append to evidenceLinks[componentId] atomically
    await obsRef.update({
      [`evidenceLinks.${componentId}`]: FieldValue.arrayUnion(fileRef),
      lastModifiedAt: FieldValue.serverTimestamp(),
    });

    return { driveFileId: fileId, name: fileName };
  },
);
