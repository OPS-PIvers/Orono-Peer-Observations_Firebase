import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, isAdminRole, type Staff } from '@ops/shared';

if (getApps().length === 0) initializeApp();

interface BackfillResult {
  scanned: number;
  backfilled: number;
  alreadyStamped: number;
}

const BATCH_SIZE = 400;

/**
 * One-shot backfill: stamp `observationId = doc.id` on every observation doc
 * where the denormalized field is missing or doesn't match the doc id.
 *
 * Manually created observations (web CreateObservationDialog before the
 * observationId fix) were written without the field, which broke dashboard
 * CTA links ("/observations/undefined") and the Acknowledge action. The
 * booking path has always stamped it server-side (bookObservationSlot).
 *
 * Idempotent — docs whose observationId already equals the doc id are left
 * untouched, and `lastModifiedAt` is deliberately NOT bumped (the stamp is
 * metadata repair, not a content change).
 *
 * Admin-gated via a live /staff lookup (token claim could be stale), matching
 * migrateRolesToSlugs.
 */
export const backfillObservationIds = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request): Promise<BackfillResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const db = getFirestore();
    const callerSnap = await db.doc(`${COLLECTIONS.staff}/${userEmail}`).get();
    const caller = callerSnap.exists ? (callerSnap.data() as Staff) : null;
    const isAdmin = !!caller && (isAdminRole(caller.role) || caller.hasAdminAccess);
    if (!isAdmin) throw new HttpsError('permission-denied', 'Admin only');

    const result: BackfillResult = { scanned: 0, backfilled: 0, alreadyStamped: 0 };

    const snap = await db.collection(COLLECTIONS.observations).get();

    let batch = db.batch();
    let opsInBatch = 0;

    for (const docSnap of snap.docs) {
      result.scanned += 1;

      const raw = docSnap.get('observationId') as unknown;
      if (raw === docSnap.id) {
        result.alreadyStamped += 1;
        continue;
      }

      batch.update(docSnap.ref, { observationId: docSnap.id });
      result.backfilled += 1;
      opsInBatch += 1;

      if (opsInBatch >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }

    if (opsInBatch > 0) {
      await batch.commit();
    }

    logger.info('backfillObservationIds: complete', result);
    return result;
  },
);
