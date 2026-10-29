import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, isCanonicalStaffEmail } from '@ops/shared';

/**
 * True when `email` names a real staff record by its canonical id
 * (lowercase, district domain, /staff doc exists). The /observations create
 * rule requires this of observedEmail; the paths that mail or share Drive
 * folders with that address re-check it here, so a doc written before the
 * rule (or by any other route) can't turn the district sender into a relay
 * to an outside mailbox.
 *
 * Archived staff still count: they keep receiving their own observation's
 * mail, as before. Pass `cache` when checking many observations in a loop.
 */
export async function isStaffBackedEmail(
  db: Firestore,
  email: unknown,
  cache?: Map<string, boolean>,
): Promise<boolean> {
  if (!isCanonicalStaffEmail(email)) return false;
  const cached = cache?.get(email);
  if (cached !== undefined) return cached;
  const snap = await db.doc(`${COLLECTIONS.staff}/${email}`).get();
  cache?.set(email, snap.exists);
  return snap.exists;
}
