import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  FieldValue,
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  OBSERVATION_STATUS,
  isAdminRole,
  type Observation,
} from '@ops/shared';
import { trashDriveFile } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

interface ReopenRequest {
  observationId?: string;
}

/**
 * The minimal transaction surface the reopen claim needs. Kept narrow (matching
 * {@link import('./finalizeClaim.js').FinalizeClaimTx}) so the compare-and-set
 * can be unit-tested with a fake transaction; the real firebase-admin
 * `Transaction` satisfies this shape.
 */
export interface ReopenClaimTx {
  get(ref: DocumentReference): Promise<DocumentSnapshot>;
  update(ref: DocumentReference, data: Record<string, unknown>): void;
}

/**
 * Atomically claim a Finalized observation for reopening.
 *
 * Inside a transaction: verify the caller is an admin and the observation is
 * still Finalized, then flip it Finalized → Draft and clear the finalize-only
 * stamps (`finalizedAt`, `acknowledgedAt`, `acknowledgedBy`) plus the PDF
 * pointer (`pdfDriveFileId`) — the live PDF is trashed by the caller after the
 * claim commits. The Drive *folder* is intentionally kept (audio recordings and
 * evidence live there, and a later re-finalize reuses it).
 *
 * Two concurrent reopen calls serialize through this compare-and-set, so only
 * the first wins; the second reads a non-Finalized status and throws
 * 'failed-precondition'.
 *
 * Returns the pre-update observation data (which still carries the old
 * `pdfDriveFileId`) so the caller can trash the superseded PDF.
 */
export async function claimObservationForReopen(
  tx: ReopenClaimTx,
  obsRef: DocumentReference,
  opts: { isAdmin: boolean },
): Promise<Observation & { id: string }> {
  const snap = await tx.get(obsRef);
  if (!snap.exists) throw new HttpsError('not-found', 'Observation not found');
  const data = { id: snap.id, ...snap.data() } as unknown as Observation & { id: string };

  if (!opts.isAdmin) {
    throw new HttpsError('permission-denied', 'Only an admin can reopen a finalized observation.');
  }
  if (data.status !== OBSERVATION_STATUS.finalized) {
    throw new HttpsError('failed-precondition', 'Observation is not finalized.');
  }

  tx.update(obsRef, {
    status: OBSERVATION_STATUS.draft,
    finalizedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: FieldValue.delete(),
    pdfDriveFileId: null,
    lastModifiedAt: FieldValue.serverTimestamp(),
  });
  return data;
}

/**
 * Reopen a finalized observation back to Draft (admin-only).
 *
 *   1. Transactionally flip Finalized → Draft, clearing finalizedAt /
 *      acknowledgedAt / acknowledgedBy and the pdfDriveFileId pointer.
 *   2. Trash the now-superseded PDF in Drive (best-effort; recoverable from
 *      Drive's trash if the reopen was a mistake). The Drive folder itself and
 *      any audio/evidence inside it are preserved.
 *   3. Write an /auditLog `observation_reopened` entry.
 *
 * The reverse transition (Draft → Finalized) is handled by finalizeObservation,
 * which re-renders the PDF and re-shares the folder — so a reopened observation
 * can be corrected and re-finalized normally.
 */
export const reopenObservation = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId } = (request.data ?? {}) as ReopenRequest;
    if (!observationId) {
      throw new HttpsError('invalid-argument', 'observationId required');
    }

    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);
    if (!isAdmin) {
      throw new HttpsError(
        'permission-denied',
        'Only an admin can reopen a finalized observation.',
      );
    }

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);

    let claimed: (Observation & { id: string }) | null = null;
    await db.runTransaction(async (tx) => {
      claimed = await claimObservationForReopen(tx, obsRef, { isAdmin });
    });
    const obs = claimed as (Observation & { id: string }) | null;
    if (!obs) throw new HttpsError('internal', 'Reopen claim did not complete');

    // Trash the superseded PDF (best-effort): a Drive hiccup must not strand the
    // observation back in a finalized-looking state — the status flip already
    // committed above. The folder is shared with the observed staff member, but
    // since the observation is now Draft they lose read access (rules gate read
    // on Finalized), so a lingering trashed PDF is harmless.
    if (obs.pdfDriveFileId) {
      try {
        await trashDriveFile(obs.pdfDriveFileId);
      } catch (err) {
        logger.error('reopenObservation: trashing old PDF failed (non-fatal)', {
          observationId,
          pdfDriveFileId: obs.pdfDriveFileId,
          err,
        });
      }
    }

    try {
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: FieldValue.serverTimestamp(),
        userEmail,
        action: AUDIT_ACTIONS.observationReopened,
        target: `${COLLECTIONS.observations}/${obs.id}`,
        details: {
          observedEmail: obs.observedEmail,
          observedName: obs.observedName,
          trashedPdfDriveFileId: obs.pdfDriveFileId,
          driveFolderId: obs.driveFolderId,
        },
      });
    } catch (auditErr) {
      logger.error('reopenObservation: audit write failed (non-fatal)', auditErr);
    }

    return { ok: true, observationId: obs.id };
  },
);
