import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  isAdminRole,
  roleYearMappingDocId,
  type Observation,
  type Role,
  type RoleYearMapping,
  type Rubric,
} from '@ops/shared';
import {
  ensureObservationFolder,
  getDriveLinks,
  shareWithUser,
  uploadFileToFolder,
} from '../lib/drive.js';
import { renderObservationPdf } from '../lib/pdfRenderer.js';
import { formatDate as formatDateReadable, sendTemplatedEmail } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

interface FinalizeRequest {
  observationId?: string;
}

/**
 * Finalize a Draft observation:
 *
 *   1. Verify the caller is the observer (or an admin) and the observation
 *      is currently Draft.
 *   2. Fetch rubric + role/year mapping (Admin SDK; bypasses rules).
 *   3. POST the observation payload to the Cloud Run pdf-renderer; receive
 *      a PDF buffer.
 *   4. Ensure the observation's Drive folder exists, upload the PDF.
 *   5. Share the folder with the observed staff member as a Reader (no
 *      email — Drive's notification-email default is suppressed).
 *   6. Flip status to Finalized, stamp finalizedAt, store pdfDriveFileId.
 *   7. Write an /auditLog entry.
 *   8. Send the observation.finalized email template (non-blocking).
 */
export const finalizeObservation = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId } = (request.data ?? {}) as FinalizeRequest;
    if (!observationId) {
      throw new HttpsError('invalid-argument', 'observationId required');
    }

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) {
      throw new HttpsError('not-found', 'Observation not found');
    }
    const obs = { id: obsSnap.id, ...obsSnap.data() } as unknown as Observation & { id: string };

    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);
    if (!isAdmin && obs.observerEmail !== userEmail) {
      throw new HttpsError('permission-denied', 'Only the observer or an admin can finalize.');
    }
    if (obs.status !== OBSERVATION_STATUS.draft) {
      throw new HttpsError('failed-precondition', 'Observation is already finalized.');
    }

    // Look up rubric via the observed role's display name.
    const rolesSnap = await db.collection(COLLECTIONS.roles).get();
    const roleDoc = rolesSnap.docs.find((d) => (d.data() as Role).displayName === obs.observedRole);
    if (!roleDoc) {
      throw new HttpsError(
        'failed-precondition',
        `No /roles entry matches role "${obs.observedRole}".`,
      );
    }
    const role = { id: roleDoc.id, ...roleDoc.data() } as unknown as Role;

    const rubricSnap = await db.doc(`${COLLECTIONS.rubrics}/${role.rubricId}`).get();
    if (!rubricSnap.exists) {
      throw new HttpsError(
        'failed-precondition',
        `Rubric "${role.rubricId}" not found for role "${obs.observedRole}".`,
      );
    }
    const rubric = { id: rubricSnap.id, ...rubricSnap.data() } as unknown as Rubric;

    const mappingDocId = roleYearMappingDocId(role.roleId, obs.observedYear);
    const mappingSnap = await db.doc(`${COLLECTIONS.roleYearMappings}/${mappingDocId}`).get();
    const mapping = mappingSnap.exists ? (mappingSnap.data() as RoleYearMapping) : null;
    const activeComponentIds = mapping?.assignedComponentIds ?? [];

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderObservationPdf({
        observation: { ...obs, observationId: obs.id },
        rubric,
        activeComponentIds,
      });
    } catch (err) {
      logger.error('finalizeObservation: PDF render failed', err);
      throw new HttpsError('internal', 'PDF rendering failed.');
    }

    let folderId: string;
    let pdfFileId: string;
    let webViewLink = '';
    try {
      folderId = await ensureObservationFolder({
        observationId: obs.id,
        observedName: obs.observedName,
        parentFolderId: PARENT_FOLDER_ID.value(),
        existingFolderId: obs.driveFolderId,
      });
      const filename = `Peer Observation — ${obs.observedName} — ${formatDateIso(new Date())}.pdf`;
      const uploaded = await uploadFileToFolder({
        folderId,
        filename,
        mimeType: 'application/pdf',
        body: pdfBuffer,
      });
      pdfFileId = uploaded.fileId;
      // Grant the observed staff Reader on the folder so they can browse
      // both the PDF and any audio recordings inside.
      await shareWithUser({
        fileId: folderId,
        email: obs.observedEmail,
        role: 'reader',
        sendNotificationEmail: false,
      });
      const links = await getDriveLinks(pdfFileId);
      webViewLink = links.webViewLink;
    } catch (err) {
      logger.error('finalizeObservation: Drive ops failed', err);
      throw new HttpsError('internal', 'Drive upload or share failed.');
    }

    const finalizedAt = FieldValue.serverTimestamp();
    await obsRef.update({
      status: OBSERVATION_STATUS.finalized,
      finalizedAt,
      pdfDriveFileId: pdfFileId,
      driveFolderId: folderId,
      lastModifiedAt: finalizedAt,
    });

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: finalizedAt,
      userEmail,
      action: 'observation.finalize',
      target: `${COLLECTIONS.observations}/${obs.id}`,
      details: {
        observedEmail: obs.observedEmail,
        observedName: obs.observedName,
        pdfDriveFileId: pdfFileId,
        driveFolderId: folderId,
      },
    });

    // Send finalized email (non-blocking — failure doesn't roll back finalization)
    try {
      const pdfLink = webViewLink ?? `https://drive.google.com/file/d/${pdfFileId}/view`;
      const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
      await sendTemplatedEmail({
        db,
        triggerType: 'observation.finalized',
        to: obs.observedEmail,
        vars: {
          observerName: (obs.observerEmail ?? '').split('@')[0],
          observerEmail: obs.observerEmail,
          observedName: obs.observedName,
          observedEmail: obs.observedEmail,
          observedRole: obs.observedRole,
          observedYear: String(obs.observedYear),
          observationDate: formatDateReadable(obs.observationDate),
          observationName: obs.observationName || '',
          observationType: obs.type,
          pdfDriveLink: pdfLink,
          driveFolderLink: folderUrl,
        },
        mailDocId: `finalized-${observationId}`,
        auditDetails: { observationId, triggerType: 'observation.finalized' },
      });
    } catch (emailErr) {
      logger.error('finalizeObservation: email send failed (non-fatal)', emailErr);
    }

    return { pdfDriveFileId: pdfFileId, driveFolderId: folderId, pdfWebViewLink: webViewLink };
  },
);

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
