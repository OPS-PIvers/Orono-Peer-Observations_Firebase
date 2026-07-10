import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  isAdminRole,
  removeEvidenceFileInput,
  type DriveFileRef,
  type Observation,
  type Staff,
} from '@ops/shared';
import { trashDriveFile } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

/**
 * Remove a single evidence file from a rubric component (companion to
 * uploadEvidenceFile, which only appends via arrayUnion). Two steps:
 *
 *   1. Atomically drop the matching `DriveFileRef` from
 *      `evidenceLinks.{componentId}` via `arrayRemove` — Firestore matches
 *      array elements by deep-equality, so we read the current array first
 *      to find the exact object to remove rather than reconstructing one
 *      client-side (uploadedAt in particular would never match a
 *      client-serialized re-encoding of the server Timestamp).
 *   2. Best-effort trash the underlying Drive file so it doesn't linger in
 *      the observation's folder. This runs after the Firestore write
 *      succeeds and its failure does not fail the callable — the evidence
 *      is already gone from the app's point of view, and an admin can
 *      still find the file in Drive if trashing didn't go through.
 *
 * Same authorization + lifecycle rule as uploadEvidenceFile: the observer
 * or an admin may remove evidence, and only while the observation is a
 * Draft (admins are exempt from the Draft-only restriction so they can
 * still clean up evidence after finalize, e.g. to correct a mis-upload
 * found during review).
 */
export const removeEvidenceFile = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = removeEvidenceFileInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { observationId, componentId, driveFileId } = parsed.data;

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) throw new HttpsError('not-found', 'Observation not found');

    const obs = obsSnap.data() as unknown as Observation;

    // Derive admin status from the live staff doc rather than the cached
    // ID token, same rationale as uploadEvidenceFile.
    const staffSnap = await db.doc(`${COLLECTIONS.staff}/${userEmail}`).get();
    const staff = staffSnap.exists ? (staffSnap.data() as Staff) : null;
    const isAdmin = !!staff && (isAdminRole(staff.role) || staff.hasAdminAccess);

    if (!isAdmin && obs.observerEmail !== userEmail) {
      throw new HttpsError('permission-denied', 'Only the observer or admin can remove evidence');
    }
    if (!isAdmin && obs.status !== 'Draft') {
      throw new HttpsError(
        'failed-precondition',
        'Cannot remove evidence from a finalized observation',
      );
    }

    const files: DriveFileRef[] = obs.evidenceLinks?.[componentId] ?? [];
    const target = files.find((f) => f.driveFileId === driveFileId);
    if (!target) {
      throw new HttpsError('not-found', 'Evidence file not found on this component');
    }

    await obsRef.update({
      [`evidenceLinks.${componentId}`]: FieldValue.arrayRemove(target),
      lastModifiedAt: FieldValue.serverTimestamp(),
    });

    // Best-effort: trash the Drive file so it doesn't linger in the
    // observation folder. A failure here doesn't undo the Firestore
    // removal — the file just needs manual cleanup in Drive.
    try {
      await trashDriveFile(driveFileId);
    } catch (err) {
      logger.warn('removeEvidenceFile: Drive trash failed, evidenceLinks entry still removed', {
        observationId,
        componentId,
        driveFileId,
        err,
      });
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail,
      action: AUDIT_ACTIONS.evidenceRemoved,
      target: `${COLLECTIONS.observations}/${observationId}`,
      details: {
        componentId,
        driveFileId,
        fileName: target.name,
        observedEmail: obs.observedEmail,
      },
    });

    return { ok: true };
  },
);
