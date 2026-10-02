import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  OBSERVATION_STATUS,
  reopenObservationInput,
  type Observation,
} from '@ops/shared';
import { callerMeetsAccessLevel } from '../lib/callerAccess.js';

if (getApps().length === 0) initializeApp();

/**
 * Reopen a Finalized observation (oversight only):
 *
 *   1. Verify the caller has oversight (Full Access) — gated via a live
 *      /staff lookup (like migrateRolesToSlugs) so a role change since the
 *      token was minted takes effect.
 *   2. Atomically flip status Finalized → Draft (transaction, so a
 *      concurrent reopen/finalize can't double-fire), clearing finalizedAt
 *      and the observed staff member's acknowledgement (the content is about
 *      to change, so any prior ack no longer applies).
 *   3. Write an /auditLog entry recording who reopened it and why.
 *
 * `pdfDriveFileId` / `driveFolderId` are intentionally KEPT: the Drive
 * folder stays shared with the observed staff member, and re-finalizing
 * replaces the existing PDF's content in place (see finalizeObservation +
 * drive.replaceFileContent) so previously shared links stay valid instead
 * of duplicate PDFs accumulating. Re-finalizing also re-sends the
 * observation.finalized email with the refreshed record.
 */
export const reopenObservation = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = reopenObservationInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { observationId, reason } = parsed.data;

    const db = getFirestore();

    // Oversight only (Full Access, from the live staff doc; Admin Console
    // access alone doesn't qualify). Building Administrators don't reopen, even their own.
    const callerRole = request.auth.token['role'] as string | undefined;
    const isOversight = await callerMeetsAccessLevel(db, {
      email: userEmail,
      tokenRole: callerRole,
      level: 'oversight',
    });
    if (!isOversight) {
      throw new HttpsError(
        'permission-denied',
        'Only a district admin can reopen a finalized observation.',
      );
    }

    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);

    // Atomically verify the status inside the transaction so a concurrent
    // finalize (or double-clicked reopen) can't race the flip.
    const obs = await db.runTransaction(async (tx) => {
      const snap = await tx.get(obsRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Observation not found');
      }
      const data = snap.data() as Observation;
      if (data.status !== OBSERVATION_STATUS.finalized) {
        throw new HttpsError(
          'failed-precondition',
          'Only a finalized observation can be reopened.',
        );
      }
      tx.update(obsRef, {
        status: OBSERVATION_STATUS.draft,
        finalizedAt: null,
        // The record is about to change — a previous acknowledgement no
        // longer covers it, so the observed staff member must re-ack after
        // re-finalization.
        acknowledgedAt: null,
        acknowledgedBy: FieldValue.delete(),
        // Re-arm the one acknowledge reminder for the next finalize.
        acknowledgeReminderSentAt: FieldValue.delete(),
        // Drop the finalize-time rubric snapshot — while Draft the editor
        // resolves the live rubric again, and re-finalizing re-captures it.
        rubricSnapshot: null,
        // Clear any stale finalize claim so re-finalizing isn't blocked.
        finalizeStartedAt: FieldValue.delete(),
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
      return data;
    });

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail,
      action: AUDIT_ACTIONS.observationReopened,
      target: `${COLLECTIONS.observations}/${observationId}`,
      details: {
        reason,
        observedEmail: obs.observedEmail,
        observedName: obs.observedName,
        observerEmail: obs.observerEmail,
        pdfDriveFileId: obs.pdfDriveFileId,
        driveFolderId: obs.driveFolderId,
      },
    });

    return { ok: true };
  },
);
