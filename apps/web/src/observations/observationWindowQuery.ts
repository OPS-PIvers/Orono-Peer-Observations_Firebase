import { type QueryConstraint, orderBy, where } from 'firebase/firestore';

/**
 * Constraints for the "my observation windows" query.
 *
 * Admins see every window. Everyone else is filtered server-side to the
 * windows they opened (`observerEmail == email`) instead of fetching all
 * windows and filtering client-side. A still-empty email filters to nothing
 * (no window has an empty observerEmail), which is the safe default during
 * the brief auth-resolve gap.
 *
 * Supported by the existing `observationWindows (observerEmail, createdAt)`
 * composite index in firestore.indexes.json.
 */
export function buildMyWindowsConstraints({
  isAdmin,
  email,
}: {
  isAdmin: boolean;
  email: string;
}): QueryConstraint[] {
  const cs: QueryConstraint[] = [orderBy('createdAt', 'desc')];
  if (!isAdmin) {
    cs.unshift(where('observerEmail', '==', email));
  }
  return cs;
}
