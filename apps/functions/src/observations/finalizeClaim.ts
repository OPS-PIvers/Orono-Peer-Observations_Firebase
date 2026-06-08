import { HttpsError } from 'firebase-functions/v2/https';
import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase-admin/firestore';
import { OBSERVATION_STATUS, type Observation } from '@ops/shared';

/**
 * The minimal transaction surface the finalize claim needs. Kept narrow so the
 * compare-and-set can be unit-tested with a fake transaction; the real
 * firebase-admin `Transaction` satisfies this shape.
 */
export interface FinalizeClaimTx {
  get(ref: DocumentReference): Promise<DocumentSnapshot>;
  update(ref: DocumentReference, data: Record<string, unknown>): void;
}

/**
 * Atomically claim a Draft observation for finalization.
 *
 * Inside a transaction: verify the caller may finalize and the observation is
 * still Draft, then flip it Draft → Finalized. Two concurrent finalize calls
 * serialize through this compare-and-set, so only the first wins; the second
 * reads a non-Draft status and throws 'failed-precondition'. That prevents the
 * duplicate Drive PDFs + duplicate emails a non-transactional read-then-write
 * would allow.
 *
 * Returns the pre-update observation data for the downstream PDF/Drive work.
 */
export async function claimObservationForFinalize(
  tx: FinalizeClaimTx,
  obsRef: DocumentReference,
  opts: { userEmail: string; isAdmin: boolean },
): Promise<Observation & { id: string }> {
  const snap = await tx.get(obsRef);
  if (!snap.exists) throw new HttpsError('not-found', 'Observation not found');
  const data = { id: snap.id, ...snap.data() } as unknown as Observation & { id: string };

  if (!opts.isAdmin && data.observerEmail !== opts.userEmail) {
    throw new HttpsError('permission-denied', 'Only the observer or an admin can finalize.');
  }
  if (data.status !== OBSERVATION_STATUS.draft) {
    throw new HttpsError('failed-precondition', 'Observation is already finalized.');
  }

  tx.update(obsRef, {
    status: OBSERVATION_STATUS.finalized,
    finalizedAt: FieldValue.serverTimestamp(),
    lastModifiedAt: FieldValue.serverTimestamp(),
  });
  return data;
}
