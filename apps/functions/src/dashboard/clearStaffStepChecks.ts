import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, STAFF_SUBCOLLECTIONS } from '@ops/shared';

/** Stay under Firestore's 500-writes-per-batch limit. */
const DELETE_BATCH = 400;

/**
 * Delete every staff-scoped evaluator check-off (`staff/{email}/stepChecks`)
 * for the given staff members. Called by the annual rollover: those checks
 * belong to the school year that just ended. Observation-tied checks live on
 * their observation and need no reset — next year's observation starts
 * fresh. Returns how many check docs were removed.
 */
export async function clearStaffStepChecks(db: Firestore, emails: string[]): Promise<number> {
  let refs: DocumentReference[] = [];
  for (const email of emails) {
    const docs = await db
      .collection(`${COLLECTIONS.staff}/${email}/${STAFF_SUBCOLLECTIONS.stepChecks}`)
      .listDocuments();
    refs = refs.concat(docs);
  }
  for (let i = 0; i < refs.length; i += DELETE_BATCH) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + DELETE_BATCH)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}
