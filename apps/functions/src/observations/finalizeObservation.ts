import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
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
  ensureObservationFolder,
  getDriveLinks,
  shareObservationFolderWithObserver,
  shareWithUser,
  uploadFileToFolder,
} from '../lib/drive.js';
import { renderObservationPdf } from '../lib/pdfRenderer.js';
import { formatDate as formatDateReadable, sendTemplatedEmail } from '../lib/emailUtils.js';
import { claimObservationForFinalize } from './finalizeClaim.js';
import { resolveRole } from './roleLookup.js';

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
 *   5. Share the folder with the observed staff member and the observer as
 *      Readers (no email — Drive's notification-email default is
 *      suppressed).
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

    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);

    // Claim the observation: atomically move Draft → Finalized so two
    // concurrent finalize calls can't both run the PDF/Drive/email work
    // (which would create duplicate Drive PDFs + duplicate emails). The
    // losing caller reads a non-Draft status inside the transaction and
    // aborts. On any later failure we roll the claim back to Draft so the
    // observer can retry.
    let claimed: (Observation & { id: string }) | null = null;
    await db.runTransaction(async (tx) => {
      claimed = await claimObservationForFinalize(tx, obsRef, { userEmail, isAdmin });
    });
    const obs = claimed as (Observation & { id: string }) | null;
    if (!obs) throw new HttpsError('internal', 'Finalize claim did not complete');

    try {
      // Look up rubric via the observed role slug. (Legacy observations may
      // still have the role's displayName here; resolveRole falls back to a
      // displayName match so finalization keeps working for un-migrated docs.)
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

      const parentFolderId = PARENT_FOLDER_ID.value();
      if (!parentFolderId) {
        throw new HttpsError(
          'failed-precondition',
          'DRIVE_PARENT_FOLDER_ID is not configured. Set it in Firebase env params before finalizing.',
        );
      }

      // The renderer expects a human-readable role label in `observedRole`,
      // not the slug we now store. Override at the renderer boundary so the
      // template doesn't need to know about the lookup. Date fields are
      // normalized to real Dates (ISO strings on the wire) for the same
      // reason — see toRendererObservation.
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await renderObservationPdf({
          observation: toRendererObservation(obs, role.displayName),
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
          parentFolderId: parentFolderId,
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
        // The observer needs Reader too: the parent folder is shared only
        // with admins and the service account, and Peer Evaluators are not
        // admins, so without this grant the Finalized banner's "Open PDF" /
        // "Open Drive folder" links land on Drive's request-access page.
        await shareObservationFolderWithObserver({
          folderId,
          observerEmail: obs.observerEmail,
        });
        const links = await getDriveLinks(pdfFileId);
        webViewLink = links.webViewLink;
      } catch (err) {
        logger.error('finalizeObservation: Drive ops failed', err);
        throw new HttpsError('internal', 'Drive upload or share failed.');
      }

      // Persist the PDF/folder ids — finalization is committed here (status
      // was already flipped by the claim transaction above).
      await obsRef.update({
        pdfDriveFileId: pdfFileId,
        driveFolderId: folderId,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });

      // ── Post-finalization side effects — must NOT roll back finalization,
      // so each is best-effort and swallows its own errors. ──────────────
      try {
        await db.collection(COLLECTIONS.auditLog).add({
          timestamp: FieldValue.serverTimestamp(),
          userEmail,
          action: AUDIT_ACTIONS.observationFinalized,
          target: `${COLLECTIONS.observations}/${obs.id}`,
          details: {
            observedEmail: obs.observedEmail,
            observedName: obs.observedName,
            pdfDriveFileId: pdfFileId,
            driveFolderId: folderId,
          },
        });
      } catch (auditErr) {
        logger.error('finalizeObservation: audit write failed (non-fatal)', auditErr);
      }

      try {
        const pdfLink = webViewLink || `https://drive.google.com/file/d/${pdfFileId}/view`;
        const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
        await sendTemplatedEmail({
          db,
          triggerType: 'observation.finalized',
          to: obs.observedEmail,
          vars: {
            observerName: obs.observerEmail.split('@')[0] ?? '',
            observerEmail: obs.observerEmail,
            observedName: obs.observedName,
            observedEmail: obs.observedEmail,
            observedRole: role.displayName,
            observedYear: String(obs.observedYear),
            observationDate: formatDateReadable(obs.observationDate),
            observationName: obs.observationName,
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
    } catch (err) {
      // The claim flipped the observation to Finalized but the PDF/Drive work
      // failed — roll it back to Draft (best-effort) so the observer can retry
      // instead of being stuck with a finalized-but-PDF-less observation.
      await obsRef
        .update({
          status: OBSERVATION_STATUS.draft,
          finalizedAt: null,
          lastModifiedAt: FieldValue.serverTimestamp(),
        })
        .catch((revertErr: unknown) =>
          logger.error('finalizeObservation: claim rollback failed', revertErr),
        );
      throw err;
    }
  },
);

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Coerce a Firestore value to a real `Date`. Observation date fields are
 * typed `Date` but arrive from the Admin SDK as `Timestamp`s at runtime;
 * left as-is they survive the gaxios JSON POST to the pdf-renderer as
 * `{_seconds,_nanoseconds}` blobs the template can't format.
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
 * Build the observation payload for the pdf-renderer: swap the role slug for
 * its display name and normalize every date the PDF renders to a real `Date`
 * (serialized as an ISO string on the wire).
 *
 * `finalizedAt` is stamped to "now": the claim transaction already wrote a
 * server timestamp, but `obs` is the pre-claim snapshot where it still reads
 * null — without this the PDF's "Finalized" row never renders.
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
      Object.entries(obs.evidenceLinks).map(([componentId, refs]): [string, DriveFileRef[]] => [
        componentId,
        refs.map((ref) => ({ ...ref, uploadedAt: toDate(ref.uploadedAt) ?? ref.uploadedAt })),
      ]),
    );
  }
  return normalized;
}
