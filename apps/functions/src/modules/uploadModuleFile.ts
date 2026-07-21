import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  ALLOWED_EMAIL_DOMAIN,
  COLLECTIONS,
  MAX_MODULE_FILE_BYTES,
  MODULE_SUBCOLLECTIONS,
  isAdminRole,
  type Staff,
} from '@ops/shared';
import { getDriveClient, uploadFileToFolder } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

/**
 * Drive folder ID where per-observation subfolders live (and, under a
 * `Modules` subfolder, module resource files). Reused for modules so the
 * district only manages a single parent folder / service-account share.
 */
const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

interface UploadModuleFileRequest {
  moduleId?: string;
  itemId?: string;
  fileName?: string;
  mimeType?: string;
  base64Data?: string;
}

interface UploadModuleFileResult {
  driveFileId: string;
  name: string;
  fileUrl: string;
}

/**
 * MIME types accepted as module resource files. Same allowlist as observation
 * evidence — documents, plain text/data, images, A/V — so an admin can't stage
 * executables or scripts in the district Drive via the module editor.
 */
export const ALLOWED_MODULE_FILE_MIME_TYPES: ReadonlySet<string> = new Set([
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
  // Audio
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

/** Name of the Drive subfolder (under the district parent) that holds all
 *  module resource files, so they don't intermingle with observation folders. */
const MODULES_FOLDER_NAME = 'Modules';

/**
 * Get or create the shared `Modules` subfolder under the district parent
 * folder, returning its Drive id. Looks the folder up by name first so we
 * reuse the same folder across uploads (and across function cold starts).
 */
async function ensureModuleFolder(parentFolderId: string): Promise<string> {
  const drive = await getDriveClient();
  const existing = await drive.files.list({
    q:
      `'${parentFolderId}' in parents and name = '${MODULES_FOLDER_NAME}' ` +
      `and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    pageSize: 1,
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;
  const created = await drive.files.create({
    requestBody: {
      name: MODULES_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });
  if (!created.data.id) throw new Error('Modules Drive folder creation returned no id');
  return created.data.id;
}

/**
 * Validate the request payload shape. Throws an `invalid-argument`
 * {@link HttpsError} on any missing/unsupported field. Pure (no I/O) so the
 * gate is unit-testable without the emulator.
 */
export function assertValidModuleFileRequest(
  data: UploadModuleFileRequest,
): asserts data is Required<UploadModuleFileRequest> {
  const { moduleId, itemId, fileName, mimeType, base64Data } = data;
  if (!moduleId || !itemId || !fileName || !mimeType || !base64Data) {
    throw new HttpsError('invalid-argument', 'Missing required fields');
  }
  if (!ALLOWED_MODULE_FILE_MIME_TYPES.has(mimeType)) {
    throw new HttpsError('invalid-argument', `Unsupported file type: ${mimeType}`);
  }
  // base64 decodes to ~3/4 of its length in bytes.
  const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
  if (estimatedBytes > MAX_MODULE_FILE_BYTES) {
    throw new HttpsError('invalid-argument', 'File exceeds the 20 MB limit');
  }
}

/**
 * Whether the live staff doc grants admin access. Derived from the staff doc
 * (not the cached ID token) so a user who lost admin in the last token TTL
 * can't still upload. Pure + exported for unit tests.
 */
export function staffHasAdminAccess(staff: Staff | null): boolean {
  return !!staff && (isAdminRole(staff.role) || staff.hasAdminAccess);
}

/**
 * Grant domain-wide Reader on a Drive file so any signed-in district user can
 * open the resource link the module page renders. The parent observations
 * folder is shared only with admins + the service account, so without this an
 * uploaded resource would land every non-admin staff member on Drive's
 * request-access page. Idempotent: skips when a matching domain reader grant
 * already exists.
 */
async function shareModuleFileWithDomain(fileId: string): Promise<void> {
  const drive = await getDriveClient();
  const existing = await drive.permissions.list({
    fileId,
    fields: 'permissions(id,type,domain,role)',
  });
  const already = existing.data.permissions?.some(
    (p) => p.type === 'domain' && p.domain === ALLOWED_EMAIL_DOMAIN && p.role === 'reader',
  );
  if (already) return;
  await drive.permissions.create({
    fileId,
    sendNotificationEmail: false,
    requestBody: { type: 'domain', role: 'reader', domain: ALLOWED_EMAIL_DOMAIN },
  });
}

/**
 * Admin-gated callable that uploads a file for a module resource item. The
 * bytes are written to a `Modules` subfolder of the district Drive parent,
 * shared domain-readable so staff can open it, and the resulting webViewLink +
 * Drive reference are persisted onto the module item doc (`fileUrl` +
 * `driveFile`). Mirrors `uploadEvidenceFile`'s base64 + live-staff-doc auth
 * pattern.
 */
export const uploadModuleFile = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request): Promise<UploadModuleFileResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const data = (request.data ?? {}) as UploadModuleFileRequest;
    assertValidModuleFileRequest(data);
    const { moduleId, itemId, fileName, mimeType, base64Data } = data;

    const db = getFirestore();

    // Derive admin status from the live staff doc rather than the cached ID
    // token (tokens live ~1 hour). Only admins may edit modules.
    const staffSnap = await db.doc(`${COLLECTIONS.staff}/${userEmail}`).get();
    const staff = staffSnap.exists ? (staffSnap.data() as Staff) : null;
    if (!staffHasAdminAccess(staff)) {
      throw new HttpsError('permission-denied', 'Only an admin can upload module files');
    }

    const itemRef = db.doc(
      `${COLLECTIONS.modules}/${moduleId}/${MODULE_SUBCOLLECTIONS.items}/${itemId}`,
    );
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) throw new HttpsError('not-found', 'Module item not found');

    const folderId = await ensureModuleFolder(PARENT_FOLDER_ID.value());

    const { fileId } = await uploadFileToFolder({
      folderId,
      filename: fileName,
      mimeType,
      body: Buffer.from(base64Data, 'base64'),
    });

    // Make the file openable by any signed-in district user. Best-effort: a
    // permissions hiccup shouldn't strand a successful upload — the file still
    // exists and an admin can re-share from Drive.
    try {
      await shareModuleFileWithDomain(fileId);
    } catch (err) {
      logger.warn('uploadModuleFile: domain share failed (non-fatal)', { fileId, err });
    }

    const fileUrl = `https://drive.google.com/file/d/${fileId}/view`;

    // Persist the link + Drive ref onto the item. If this fails after the
    // Drive upload succeeded, best-effort delete the orphan so it doesn't
    // pile up in the Modules folder.
    try {
      await itemRef.update({
        fileUrl,
        driveFile: {
          driveFileId: fileId,
          name: fileName,
          mimeType,
          uploadedAt: new Date(),
          uploadedBy: userEmail,
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: userEmail,
      });
    } catch (err) {
      try {
        await (await getDriveClient()).files.delete({ fileId });
      } catch (cleanupErr) {
        logger.warn('uploadModuleFile: orphan cleanup failed', { fileId, cleanupErr });
      }
      throw err;
    }

    return { driveFileId: fileId, name: fileName, fileUrl };
  },
);
