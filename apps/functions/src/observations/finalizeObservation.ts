import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  isAdminRole,
  roleYearMappingDocId,
  workProductAnswerHasText,
  type AppSettings,
  type Observation,
  type Role,
  type RoleYearMapping,
  type Rubric,
  type RubricDomain,
  type WorkProductQuestion,
} from '@ops/shared';
import {
  ensureObservationFolder,
  getDriveLinks,
  replaceFileContent,
  shareWithUser,
  uploadFileToFolder,
} from '../lib/drive.js';
import { renderObservationPdf } from '../lib/pdfRenderer.js';
import { formatDate as formatDateReadable, sendTemplatedEmail } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

const PARENT_FOLDER_ID = defineString('DRIVE_PARENT_FOLDER_ID');

/**
 * How long a `finalizeStartedAt` claim is honored before a new call is
 * allowed to retry. Bounds how long a crashed/timed-out attempt can wedge
 * the observation if the final status flip never runs.
 */
const FINALIZE_CLAIM_TTL_MS = 10 * 60 * 1000;

interface FinalizeRequest {
  observationId?: string;
}

/**
 * Finalize a Draft observation:
 *
 *   1. Verify the caller is the observer (or an admin) and the observation
 *      is currently Draft.
 *   2. Atomically claim the finalize transition (transaction) so two
 *      near-simultaneous calls can't both pass the Draft check.
 *   3. Fetch rubric + role/year mapping (Admin SDK; bypasses rules).
 *   4. POST the observation payload to the Cloud Run pdf-renderer; receive
 *      a PDF buffer.
 *   5. Ensure the observation's Drive folder exists, upload the PDF.
 *   6. Share the folder with the observed staff member as a Reader (no
 *      email — Drive's notification-email default is suppressed).
 *   7. Flip status to Finalized, stamp finalizedAt, store pdfDriveFileId.
 *   8. Write an /auditLog entry.
 *   9. Send the observation.finalized email template (non-blocking).
 *
 * Any failure after the claim (step 2) clears `finalizeStartedAt` so the
 * user can retry instead of being permanently locked out of finalizing.
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

    // Atomically claim the finalize transition. Re-reads the observation
    // inside the transaction (rather than trusting the read above) and
    // rejects the claim if the status has already moved past Draft, or if
    // another call claimed it recently and hasn't finished yet. A claim
    // older than FINALIZE_CLAIM_TTL_MS is treated as abandoned (the worker
    // crashed/timed out) and may be retried.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(obsRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Observation not found');
      }
      const data = snap.data() as Observation & { finalizeStartedAt?: FirebaseFirestore.Timestamp };
      if (data.status !== OBSERVATION_STATUS.draft) {
        throw new HttpsError('failed-precondition', 'Observation is already finalized.');
      }
      const claimedAt = data.finalizeStartedAt;
      if (claimedAt && Date.now() - claimedAt.toMillis() < FINALIZE_CLAIM_TTL_MS) {
        throw new HttpsError(
          'failed-precondition',
          'This observation is already being finalized. Please try again shortly.',
        );
      }
      tx.update(obsRef, { finalizeStartedAt: FieldValue.serverTimestamp() });
    });

    try {
      // Look up rubric via the observed role slug. (Legacy observations may
      // still have the role's displayName here; fall back to that match so
      // we don't break finalization for un-migrated docs.)
      const roleByIdSnap = await db
        .collection(COLLECTIONS.roles)
        .where('roleId', '==', obs.observedRole)
        .limit(1)
        .get();
      const roleByNameSnap = roleByIdSnap.empty
        ? await db
            .collection(COLLECTIONS.roles)
            .where('displayName', '==', obs.observedRole)
            .limit(1)
            .get()
        : null;
      const roleDoc = !roleByIdSnap.empty ? roleByIdSnap.docs[0] : roleByNameSnap?.docs[0];
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
          `Rubric "${role.rubricId}" not found for role "${role.displayName}".`,
        );
      }
      const rubric = { id: rubricSnap.id, ...rubricSnap.data() } as unknown as Rubric;

      const mappingDocId = roleYearMappingDocId(role.roleId, obs.observedYear);
      const mappingSnap = await db.doc(`${COLLECTIONS.roleYearMappings}/${mappingDocId}`).get();
      const mapping = mappingSnap.exists ? (mappingSnap.data() as RoleYearMapping) : null;
      const activeComponentIds = mapping?.assignedComponentIds ?? [];

      // Freeze the rubric content actually used so the finalized read-only
      // view renders the criteria text as it stood at finalize time — later
      // rubric edits must never silently rewrite the historical record (the
      // archived PDF already keeps the old wording; this keeps the in-app
      // view consistent with it). Domains are resolved the way the PDF
      // template resolves them: narrowed to the role-year mapping when one
      // exists, falling back to the full rubric otherwise.
      const snapshotDomains = resolveSnapshotDomains(rubric.domains, activeComponentIds);

      // Work Product / Instructional Round observations store their substance
      // as Q&A answers keyed on questionId. Fetch the matching question bank
      // so the PDF can print each answer under its question text. Every
      // question of the type is fetched (not just active ones) so answers to
      // since-deactivated questions still make it into the permanent record.
      const questionType =
        obs.type === OBSERVATION_TYPES.workProduct
          ? 'work-product'
          : obs.type === OBSERVATION_TYPES.instructionalRound
            ? 'instructional-round'
            : null;
      let workProductQuestions: Pick<WorkProductQuestion, 'questionId' | 'text'>[] = [];
      if (questionType) {
        const questionsSnap = await db
          .collection(COLLECTIONS.workProductQuestions)
          .where('type', '==', questionType)
          .get();
        const answeredIds = new Set(
          (obs.workProductAnswers ?? [])
            .filter((a) => workProductAnswerHasText(a.answer))
            .map((a) => a.questionId),
        );
        workProductQuestions = questionsSnap.docs
          .map((doc) => doc.data() as WorkProductQuestion)
          .filter((q) => q.isActive || answeredIds.has(q.questionId))
          .sort((a, b) => a.order - b.order)
          .map((q) => ({ questionId: q.questionId, text: q.text }));
      }

      // Thread admin-configured branding into the PDF so the archived
      // record matches the web app / finalized-observation email header.
      // Missing/unset appSettings is fine — the renderer falls back to the
      // packaged OPS look.
      const appSettingsSnap = await db
        .doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`)
        .get();
      const branding = (appSettingsSnap.data() as AppSettings | undefined)?.branding;

      const parentFolderId = PARENT_FOLDER_ID.value();
      if (!parentFolderId) {
        throw new HttpsError(
          'failed-precondition',
          'DRIVE_PARENT_FOLDER_ID is not configured. Set it in Firebase env params before finalizing.',
        );
      }

      // The renderer expects a human-readable role label in `observedRole`,
      // not the slug we now store. Override at the renderer boundary so the
      // template doesn't need to know about the lookup.
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await renderObservationPdf({
          observation: { ...obs, observationId: obs.id, observedRole: role.displayName },
          rubric,
          activeComponentIds,
          workProductQuestions,
          ...(branding ? { branding } : {}),
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
        // Re-finalize after an admin reopen: replace the previous PDF's
        // content in place so the fileId — and any link already emailed or
        // bookmarked — stays stable instead of a duplicate PDF piling up in
        // the folder. Falls back to a fresh upload if the old file is gone.
        let replacedFileId: string | null = null;
        if (obs.pdfDriveFileId) {
          replacedFileId = await replaceFileContent({
            fileId: obs.pdfDriveFileId,
            filename,
            mimeType: 'application/pdf',
            body: pdfBuffer,
          });
        }
        if (replacedFileId) {
          pdfFileId = replacedFileId;
        } else {
          const uploaded = await uploadFileToFolder({
            folderId,
            filename,
            mimeType: 'application/pdf',
            body: pdfBuffer,
          });
          pdfFileId = uploaded.fileId;
        }
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
        rubricSnapshot: {
          rubricId: rubric.rubricId,
          displayName: rubric.displayName,
          domains: snapshotDomains,
          assignedComponentIds: snapshotDomains.flatMap((d) => d.components.map((c) => c.id)),
          capturedAt: new Date(),
        },
        lastModifiedAt: finalizedAt,
        finalizeStartedAt: FieldValue.delete(),
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
      // Clear the claim so a retry isn't permanently blocked by a stale
      // in-progress marker.
      await obsRef.update({ finalizeStartedAt: FieldValue.delete() }).catch((clearErr: unknown) => {
        logger.error('finalizeObservation: failed to clear finalize claim after error', clearErr);
      });
      throw err;
    }
  },
);

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Narrow rubric domains to the components active for the observed
 * role/year, dropping domains that end up empty. Mirrors the PDF template's
 * allow-list semantics: an empty `activeComponentIds` means "no mapping
 * narrows this" and keeps the full rubric — as does a mapping that would
 * filter everything out, so the stored snapshot is never empty.
 */
function resolveSnapshotDomains(
  domains: RubricDomain[],
  activeComponentIds: string[],
): RubricDomain[] {
  if (activeComponentIds.length === 0) return domains;
  const allow = new Set(activeComponentIds);
  const filtered = domains
    .map((d) => ({ ...d, components: d.components.filter((c) => allow.has(c.id)) }))
    .filter((d) => d.components.length > 0);
  return filtered.length > 0 ? filtered : domains;
}
