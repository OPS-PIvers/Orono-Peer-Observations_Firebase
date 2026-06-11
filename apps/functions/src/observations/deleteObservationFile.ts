import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  isAdminRole,
  type DriveFileRef,
  type Observation,
  type Staff,
} from '@ops/shared';
import { deleteDriveFile, getDriveClient } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

interface DeleteObservationFileRequest {
  observationId?: string;
  kind?: 'evidence' | 'audio';
  /** Required when kind === 'evidence' */
  componentId?: string;
  driveFileId?: string;
}

/**
 * Delete a single evidence file or audio recording from a Draft observation.
 *
 * Guards:
 *   - Caller must be the observer or an admin.
 *   - Observation must be Draft.
 *
 * For evidence: removes the matching DriveFileRef from
 * `evidenceLinks[componentId]` via arrayRemove.
 *
 * For audio: removes the fileId from `audioDriveFileIds` via arrayRemove, and
 * also deletes the transcript entry (`transcripts[driveFileId]`) if present.
 *
 * The Drive file is deleted first; if the Firestore update subsequently fails
 * we log and re-throw (the file is gone from Drive but the dangling ref would
 * just render as a broken link — still better than leaving an accessible file
 * that should have been removed).
 */
export const deleteObservationFile = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId, kind, componentId, driveFileId } = (request.data ??
      {}) as DeleteObservationFileRequest;

    if (!observationId) throw new HttpsError('invalid-argument', 'observationId is required');
    if (kind !== 'evidence' && kind !== 'audio') {
      throw new HttpsError('invalid-argument', 'kind must be "evidence" or "audio"');
    }
    if (kind === 'evidence' && !componentId) {
      throw new HttpsError('invalid-argument', 'componentId is required for evidence deletion');
    }
    if (!driveFileId) throw new HttpsError('invalid-argument', 'driveFileId is required');

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) throw new HttpsError('not-found', 'Observation not found');

    const obs = obsSnap.data() as unknown as Observation;

    // Derive admin status from the live staff doc (avoids stale ID-token claims).
    const staffSnap = await db.doc(`${COLLECTIONS.staff}/${userEmail}`).get();
    const staff = staffSnap.exists ? (staffSnap.data() as Staff) : null;
    const isAdmin = !!staff && (isAdminRole(staff.role) || staff.hasAdminAccess);

    if (!isAdmin && obs.observerEmail !== userEmail) {
      throw new HttpsError(
        'permission-denied',
        'Only the observer or an admin can remove files from an observation',
      );
    }
    if (obs.status !== OBSERVATION_STATUS.draft) {
      throw new HttpsError(
        'failed-precondition',
        'Files can only be removed from a Draft observation',
      );
    }

    // Verify the file is actually referenced in this observation before touching Drive.
    if (kind === 'evidence') {
      // componentId is guaranteed present here by the validation above, but the
      // discriminant on `kind` doesn't narrow it — re-check to keep types honest.
      if (!componentId) {
        throw new HttpsError('invalid-argument', 'componentId is required for evidence deletion');
      }
      const refs: DriveFileRef[] = obs.evidenceLinks?.[componentId] ?? [];
      const found = refs.some((r) => r.driveFileId === driveFileId);
      if (!found) {
        throw new HttpsError(
          'not-found',
          `Evidence file ${driveFileId} not found in component ${componentId}`,
        );
      }
    } else {
      const ids: string[] = obs.audioDriveFileIds;
      if (!ids.includes(driveFileId)) {
        throw new HttpsError(
          'not-found',
          `Audio file ${driveFileId} not found in this observation`,
        );
      }
    }

    // Delete the Drive file (non-fatal 404 is handled inside deleteDriveFile).
    try {
      await deleteDriveFile(driveFileId);
    } catch (err) {
      logger.error('deleteObservationFile: Drive delete failed', { driveFileId, err });
      throw new HttpsError('internal', 'Failed to delete file from Drive');
    }

    // Remove the reference from Firestore.
    try {
      if (kind === 'evidence') {
        // componentId is guaranteed present here by the validation above, but the
        // discriminant on `kind` doesn't narrow it — re-check to keep types honest.
        if (!componentId) {
          throw new HttpsError('invalid-argument', 'componentId is required for evidence deletion');
        }
        // Build the full DriveFileRef object for arrayRemove. Firestore's
        // arrayRemove does deep equality — we need the exact stored object.
        // Re-derive it from the live snapshot to avoid shape drift.
        const refs: DriveFileRef[] = obs.evidenceLinks?.[componentId] ?? [];
        const ref = refs.find((r) => r.driveFileId === driveFileId);
        if (ref) {
          await obsRef.update({
            [`evidenceLinks.${componentId}`]: FieldValue.arrayRemove(ref),
            lastModifiedAt: FieldValue.serverTimestamp(),
          });
        }
      } else {
        // For audio we also purge the transcript and any Gemini file ref.
        const updatePayload: Record<string, unknown> = {
          audioDriveFileIds: FieldValue.arrayRemove(driveFileId),
          lastModifiedAt: FieldValue.serverTimestamp(),
        };
        // Only delete the transcripts sub-key if it exists — FieldValue.delete()
        // on a non-existent map key is a no-op but we skip it to keep the payload clean.
        if (driveFileId in obs.transcripts) {
          updatePayload[`transcripts.${driveFileId}`] = FieldValue.delete();
        }
        await obsRef.update(updatePayload);
      }
    } catch (err) {
      // Drive file is already gone at this point. Log the Firestore failure but
      // surface it so the client knows the ref wasn't cleaned up.
      logger.error('deleteObservationFile: Firestore update failed after Drive delete', {
        driveFileId,
        kind,
        err,
      });
      throw err;
    }

    // Prune any pending/completed transcription job doc for this audio file so
    // stale job statuses don't surface in the UI.
    if (kind === 'audio') {
      try {
        const jobQuery = await db
          .collection(COLLECTIONS.transcriptionJobs)
          .where('observationId', '==', observationId)
          .where('audioFileId', '==', driveFileId)
          .limit(10)
          .get();
        await Promise.all(jobQuery.docs.map((d) => d.ref.delete()));
        // Best-effort: purge the Gemini-managed file if the job doc carries the id.
        for (const d of jobQuery.docs) {
          const geminiFileId = (d.data() as { geminiFileId?: string }).geminiFileId;
          if (geminiFileId) {
            try {
              await getDriveClient().files.delete({ fileId: geminiFileId });
            } catch {
              // Non-fatal — the Gemini file will be swept by pruneOrphanGeminiFiles.
            }
          }
        }
      } catch (err) {
        // Non-fatal: job cleanup is best-effort.
        logger.warn('deleteObservationFile: transcription job cleanup failed', {
          observationId,
          driveFileId,
          err,
        });
      }
    }

    return { deleted: true };
  },
);
