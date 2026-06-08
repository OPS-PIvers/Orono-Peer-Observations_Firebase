import { type QueryConstraint, where } from 'firebase/firestore';

/**
 * Constraints for the staff directory.
 *
 * By default (Show inactive off) the active/inactive split is filtered
 * server-side (`isActive == true`) instead of fetching every staff record
 * and hiding the inactive ones client-side. No `orderBy` is issued on the
 * wire — a single equality filter needs only Firestore's automatic
 * single-field index, and the page sorts by name client-side — so this adds
 * no new composite index. When "Show inactive" is on we fetch everyone.
 */
export function buildStaffDirectoryConstraints(showInactive: boolean): QueryConstraint[] {
  return showInactive ? [] : [where('isActive', '==', true)];
}
