import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  OBSERVATION_STATUS,
  isAdminRole,
  roleYearMappingDocId,
  type DriveFileRef,
  type Observation,
  type RoleYearMapping,
  type Rubric,
} from '@ops/shared';
import {
  deleteDriveFile,
  ensureObservationFolder,
  getDriveLinks,
  shareObservationFolderWithObserver,
  shareWithUser,
  uploadFileToFolder,
} from '../lib/drive.js';
import { renderObservationPdf } from '../lib/pdfRenderer.js';
import { resolveRole } from './roleLookup.js';

if (getApps().length === 0) initializeApp();

const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

interface RegenerateRequest {
  observationId?: string;
}

/**
 * Regenerate the PDF for a Finalized observation (admin or the observer).
 *
 * Re-renders the observation through the pdf-renderer, uploads the fresh PDF to
 * the observation's existing Drive folder, repoints `pdfDriveFileId` at it, then
 * deletes the superseded PDF so the folder never accumulates stale copies.
 * Re-shares the folder (idempotently) so the observed staff member and observer
 * keep Reader access. Writes a `pdf_regenerated` audit entry.
 *
 * Used after an admin reopens → corrects → re-finalizes (covers a failed
 * finalize that left the observation Finalized with no PDF), or when the
 * observed/observer needs a fresh copy without changing any content.
 */
export const regenerateObservationPdf = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId } = (request.data ?? {}) as RegenerateRequest;
    if (!observationId) {
      throw new HttpsError('invalid-argument', 'observationId required');
    }

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);

    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);

    const snap = await obsRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Observation not found');
    const obs = { id: snap.id, ...snap.data() } as unknown as Observation & { id: string };

    if (!isAdmin && obs.observerEmail !== userEmail) {
      throw new HttpsError(
        'permission-denied',
        'Only the observer or an admin can regenerate the PDF.',
      );
    }
    if (obs.status !== OBSERVATION_STATUS.finalized) {
      throw new HttpsError(
        'failed-precondition',
        'Only a finalized observation can have its PDF regenerated.',
      );
    }

    const { rubric, activeComponentIds, roleDisplayName } = await loadRenderInputs(db, obs);

    const parentFolderId = PARENT_FOLDER_ID.value();
    if (!parentFolderId) {
      throw new HttpsError(
        'failed-precondition',
        'DRIVE_PARENT_FOLDER_ID is not configured. Set it in Firebase env params before regenerating.',
      );
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await renderObservationPdf({
        observation: toRendererObservation(obs, roleDisplayName),
        rubric,
        activeComponentIds,
      });
    } catch (err) {
      logger.error('regenerateObservationPdf: PDF render failed', err);
      throw new HttpsError('internal', 'PDF rendering failed.');
    }

    const previousPdfFileId = obs.pdfDriveFileId;
    let folderId: string;
    let pdfFileId: string;
    let webViewLink = '';
    try {
      folderId = await ensureObservationFolder({
        observationId: obs.id,
        observedName: obs.observedName,
        parentFolderId,
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
      // Re-grant Reader (idempotent) so the observed staff + observer can open
      // the fresh PDF even if the folder was recreated.
      await shareWithUser({
        fileId: folderId,
        email: obs.observedEmail,
        role: 'reader',
        sendNotificationEmail: false,
      });
      await shareObservationFolderWithObserver({
        folderId,
        observerEmail: obs.observerEmail,
      });
      const links = await getDriveLinks(pdfFileId);
      webViewLink = links.webViewLink;
    } catch (err) {
      logger.error('regenerateObservationPdf: Drive ops failed', err);
      throw new HttpsError('internal', 'Drive upload or share failed.');
    }

    // Repoint the observation at the new PDF before deleting the old one, so a
    // crash between the two can never leave pdfDriveFileId dangling at a
    // deleted file.
    await obsRef.update({
      pdfDriveFileId: pdfFileId,
      driveFolderId: folderId,
      lastModifiedAt: FieldValue.serverTimestamp(),
    });

    // Delete the superseded PDF (best-effort) — never roll back the
    // regeneration over a cleanup failure.
    if (previousPdfFileId && previousPdfFileId !== pdfFileId) {
      try {
        await deleteDriveFile(previousPdfFileId);
      } catch (err) {
        logger.error('regenerateObservationPdf: deleting old PDF failed (non-fatal)', {
          observationId,
          previousPdfFileId,
          err,
        });
      }
    }

    try {
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: FieldValue.serverTimestamp(),
        userEmail,
        action: AUDIT_ACTIONS.pdfRegenerated,
        target: `${COLLECTIONS.observations}/${obs.id}`,
        details: {
          observedEmail: obs.observedEmail,
          observedName: obs.observedName,
          pdfDriveFileId: pdfFileId,
          previousPdfDriveFileId: previousPdfFileId,
          driveFolderId: folderId,
        },
      });
    } catch (auditErr) {
      logger.error('regenerateObservationPdf: audit write failed (non-fatal)', auditErr);
    }

    return { pdfDriveFileId: pdfFileId, driveFolderId: folderId, pdfWebViewLink: webViewLink };
  },
);

interface RenderInputs {
  rubric: Rubric;
  activeComponentIds: string[];
  roleDisplayName: string;
}

/**
 * Resolve the rubric, role display name, and active component ids the renderer
 * needs for this observation. Mirrors the lookups finalizeObservation performs.
 */
async function loadRenderInputs(
  db: Firestore,
  obs: Observation & { id: string },
): Promise<RenderInputs> {
  const role = await resolveRole(db, obs.observedRole);
  if (!role) {
    throw new HttpsError(
      'failed-precondition',
      `No /roles entry matches role "${obs.observedRole}".`,
    );
  }

  const rubricSnap = await db.doc(`${COLLECTIONS.rubrics}/${role.rubricId}`).get();
  if (!rubricSnap.exists) {
    throw new HttpsError(
      'failed-precondition',
      `Rubric "${role.rubricId}" not found for role "${role.displayName}".`,
    );
  }
  const rubric = { id: rubricSnap.id, ...rubricSnap.data() } as unknown as Rubric;

  const mappingDocId = roleYearMappingDocId(role.roleId, obs.observedYear);
  const mappingSnap = await db.doc(`${COLLECTIONS.roleYearMappings}/${mappingDocId}`).get();
  const mapping = mappingSnap.exists ? (mappingSnap.data() as RoleYearMapping) : null;
  const activeComponentIds = mapping?.assignedComponentIds ?? [];

  return { rubric, activeComponentIds, roleDisplayName: role.displayName };
}

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Coerce a Firestore value to a real `Date`. Date fields are typed `Date` but
 * arrive from the Admin SDK as `Timestamp`s at runtime; left as-is they survive
 * the gaxios JSON POST to the pdf-renderer as `{_seconds,_nanoseconds}` blobs
 * the template can't format. (Mirrors finalizeObservation's `toDate`.)
 */
function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

/**
 * Build the observation payload for the pdf-renderer: swap the role slug for its
 * display name and normalize every rendered date to a real `Date`. Unlike
 * finalize, a regenerate keeps the existing `finalizedAt` (the observation is
 * already Finalized), falling back to now only if it is somehow unset.
 */
function toRendererObservation(
  obs: Observation & { id: string },
  roleDisplayName: string,
): Observation {
  const normalized: Observation = {
    ...obs,
    observationId: obs.id,
    observedRole: roleDisplayName,
    observationDate: toDate(obs.observationDate) ?? obs.observationDate,
    finalizedAt: toDate(obs.finalizedAt) ?? new Date(),
  };
  const preObsDate = toDate(obs.preObsDate);
  if (preObsDate) normalized.preObsDate = preObsDate;
  const postObsDate = toDate(obs.postObsDate);
  if (postObsDate) normalized.postObsDate = postObsDate;
  if (obs.evidenceLinks) {
    normalized.evidenceLinks = Object.fromEntries(
      Object.entries(obs.evidenceLinks).map(([cId, refs]): [string, DriveFileRef[]] => [
        cId,
        refs.map((ref) => ({ ...ref, uploadedAt: toDate(ref.uploadedAt) ?? ref.uploadedAt })),
      ]),
    );
  }
  return normalized;
}
