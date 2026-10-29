import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  canManageObservation,
  COLLECTIONS,
  displayYear,
  OBSERVATION_STATUS,
  resolveReportDomains,
  roleYearMappingDocId,
  type Observation,
  type Role,
  type RoleYearMapping,
  type Rubric,
} from '@ops/shared';
import {
  DRIVE_SECRETS,
  DRIVE_SERVICE_ACCOUNT,
  ensureObservationFolder,
  filesInObservationFolder,
  getDriveLinks,
  replaceFileContent,
  shareObservationFolderWithObservers,
  shareWithUser,
  trashDriveFile,
  uploadFileToFolder,
} from '../lib/drive.js';
import { renderObservationPdf } from '../lib/pdfRenderer.js';
import {
  APP_URL,
  formatDate as formatDateReadable,
  observerNameOf,
  sendTemplatedEmail,
} from '../lib/emailUtils.js';
import {
  acknowledgeBlockHtml,
  acknowledgeLinkFor,
  pdfAttachment,
  reportFileName,
} from '../lib/acknowledgeEmail.js';
import { callerObservationAccess } from '../lib/observationAccess.js';
import { loadPdfQuestionsAndBranding, toRendererObservation } from './renderInputs.js';

/**
 * Pull a human-readable cause out of a Drive/Gaxios error so the message the
 * evaluator reads (and forwards to us) names the actual failure — "File not
 * found: <id>", "storageQuotaExceeded" — instead of a generic string that
 * costs a log dive to decode.
 */
function driveErrorDetail(err: unknown): string {
  const cause = (err as { cause?: { message?: string } }).cause;
  if (cause?.message) return cause.message;
  if (err instanceof Error && err.message) return err.message;
  return 'unknown error';
}

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
  /** Remove the audio recordings (and their transcripts) as part of
   *  finalizing, and move the files to the Drive trash. */
  deleteAudio?: unknown;
}

/** Drive file ids are `[A-Za-z0-9_-]`; checked before an id becomes part of
 *  a Firestore field path. */
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]+$/;

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
 * With `deleteAudio`, the recordings and their transcripts are left out of
 * the PDF and dropped in the same write as the status flip (so a failed
 * finalize loses nothing), then the files are trashed best-effort, like
 * removeRecording. Text already inserted into the script stays.
 *
 * Any failure after the claim (step 2) clears `finalizeStartedAt` so the
 * user can retry instead of being permanently locked out of finalizing.
 */
export const finalizeObservation = onCall(
  // maxInstances caps concurrent Drive/pdf-renderer work to bound cost/abuse
  // exposure — not copied from onObservationWritten's maxInstances: 1, which
  // exists there solely to respect the Sheets API's 60-writes/min quota.
  {
    // Demo-edit sessions allowed; confined to demo staff below.
    allowDemoEdit: true,
    region: 'us-central1',
    serviceAccount: DRIVE_SERVICE_ACCOUNT,
    secrets: DRIVE_SECRETS,
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 10,
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId, deleteAudio } = (request.data ?? {}) as FinalizeRequest;
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
    // Owner or oversight only: a co-observer edits the draft but the owner
    // finalizes it, and building Administrators get no override.
    const access = await callerObservationAccess(db, obs, {
      email: userEmail,
      tokenRole: callerRole,
      auth: request.auth,
    });
    if (!canManageObservation(access)) {
      throw new HttpsError(
        'permission-denied',
        'Only the observer who created this observation can finalize it.',
      );
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

    // Ids from the doc read above. Finalize is blocked in the UI while a
    // recording is in flight, and arrayRemove below leaves any other id alone.
    const removedAudioIds =
      deleteAudio === true ? obs.audioDriveFileIds.filter((id) => DRIVE_FILE_ID_RE.test(id)) : [];
    const reportObs = removedAudioIds.length > 0 ? withoutRecordings(obs, removedAudioIds) : obs;

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
      // Freeze the rubric content actually used so the finalized read-only
      // view renders the criteria text as it stood at finalize time — later
      // rubric edits must never silently rewrite the historical record (the
      // archived PDF already keeps the old wording; this keeps the in-app
      // view consistent with it). The report covers the role-year's assigned
      // components plus anything else the evaluator rated, noted or tagged
      // (administrators may observe against the whole rubric); the PDF gets
      // the same component list so the two always agree.
      const snapshotDomains = resolveReportDomains(
        rubric.domains,
        mapping?.assignedComponentIds ?? [],
        obs,
      );
      const activeComponentIds = snapshotDomains.flatMap((d) => d.components.map((c) => c.id));

      const { workProductQuestions, branding } = await loadPdfQuestionsAndBranding(db, obs);

      const parentFolderId = PARENT_FOLDER_ID.value();
      if (!parentFolderId) {
        throw new HttpsError(
          'failed-precondition',
          'DRIVE_PARENT_FOLDER_ID is not configured. Set it in Firebase env params before finalizing.',
        );
      }

      // The renderer expects a human-readable role label in `observedRole`,
      // not the slug we now store, and real Dates rather than the Admin SDK's
      // Timestamps. finalizedAt is still unset on the doc, so pass now.
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await renderObservationPdf({
          observation: toRendererObservation(reportObs, role.displayName, new Date()),
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
        // Only a PDF in this observation's own folder is overwritten.
        let replacedFileId: string | null = null;
        const pdfInFolder = obs.pdfDriveFileId
          ? (
              await filesInObservationFolder({
                fileIds: [obs.pdfDriveFileId],
                folderId,
                parentFolderId,
              })
            ).includes(obs.pdfDriveFileId)
          : false;
        if (obs.pdfDriveFileId && pdfInFolder) {
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
        // The observers need the same access to open the PDF they just
        // finalized; without it they land on Drive's request-access page.
        await shareObservationFolderWithObservers({
          folderId,
          observerEmail: obs.observerEmail,
          coObserverEmails: obs.coObserverEmails,
        });
        const links = await getDriveLinks(pdfFileId);
        webViewLink = links.webViewLink;
      } catch (err) {
        logger.error('finalizeObservation: Drive ops failed', err);
        throw new HttpsError('internal', `Drive upload or share failed: ${driveErrorDetail(err)}`);
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
          assignedComponentIds: activeComponentIds,
          capturedAt: new Date(),
        },
        lastModifiedAt: finalizedAt,
        finalizeStartedAt: FieldValue.delete(),
        ...recordingRemovalPatch(removedAudioIds),
      });

      // Best-effort, after the status flip: a file left behind only needs
      // cleanup in Drive, and the observation no longer points at it. Only
      // recordings in this observation's own folder are trashed, each on its
      // own so one Drive error leaves only that file behind.
      const trashResults = await Promise.allSettled(
        removedAudioIds.map(async (id) => {
          const [inFolder] = await filesInObservationFolder({
            fileIds: [id],
            folderId,
            parentFolderId,
          });
          if (inFolder) await trashDriveFile(inFolder);
        }),
      );
      trashResults.forEach((r, i) => {
        if (r.status === 'rejected') {
          logger.warn('finalizeObservation: Drive trash failed, recording still removed', {
            observationId,
            audioFileId: removedAudioIds[i],
            err: r.reason as unknown,
          });
        }
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
          ...(removedAudioIds.length > 0 ? { deletedAudioFileIds: removedAudioIds } : {}),
        },
      });

      // Send finalized email (non-blocking — failure doesn't roll back finalization).
      // The PDF rides along as an attachment when it fits; otherwise the
      // acknowledge block links to it. The block (with the "Acknowledge
      // receipt" button) is appended unless the template places
      // {{acknowledgeLink}} itself.
      try {
        const pdfLink = webViewLink || `https://drive.google.com/file/d/${pdfFileId}/view`;
        const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
        const acknowledgeLink = acknowledgeLinkFor(APP_URL, observationId);
        const attachment = pdfAttachment(pdfBuffer, reportFileName(obs.observedName));
        await sendTemplatedEmail({
          db,
          triggerType: 'observation.finalized',
          to: obs.observedEmail,
          vars: {
            observerName: observerNameOf(obs),
            observerEmail: obs.observerEmail,
            observedName: obs.observedName,
            observedEmail: obs.observedEmail,
            observedRole: role.displayName,
            observedYear: String(displayYear(obs.observedYear)),
            observationDate: formatDateReadable(obs.observationDate),
            observationName: obs.observationName,
            observationType: obs.type,
            pdfDriveLink: pdfLink,
            driveFolderLink: folderUrl,
            acknowledgeLink,
          },
          mailDocId: `finalized-${observationId}`,
          auditDetails: { observationId, triggerType: 'observation.finalized' },
          ...(attachment ? { attachments: [attachment] } : {}),
          requiredBlock: {
            html: acknowledgeBlockHtml({
              acknowledgeLink,
              pdfLink,
              pdfAttached: attachment !== null,
            }),
            unlessUses: 'acknowledgeLink',
          },
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

/** The observation as it will read once these recordings are removed. */
function withoutRecordings<T extends Observation>(obs: T, ids: string[]): T {
  const drop = new Set(ids);
  const keep = <V>(m: Record<string, V> | undefined) =>
    m ? Object.fromEntries(Object.entries(m).filter(([id]) => !drop.has(id))) : m;
  return {
    ...obs,
    audioDriveFileIds: obs.audioDriveFileIds.filter((id) => !drop.has(id)),
    transcripts: keep(obs.transcripts) ?? {},
    audioRecordings: keep(obs.audioRecordings),
  };
}

/** Same fields removeRecording clears, for each id. */
function recordingRemovalPatch(ids: string[]): Record<string, unknown> {
  if (ids.length === 0) return {};
  const patch: Record<string, unknown> = { audioDriveFileIds: FieldValue.arrayRemove(...ids) };
  for (const id of ids) {
    patch[`audioRecordings.${id}`] = FieldValue.delete();
    patch[`transcripts.${id}`] = FieldValue.delete();
  }
  return patch;
}

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}
