import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type Role } from '@ops/shared';

/**
 * Resolve a /roles entry from the value stored on an observation/staff doc.
 *
 * `observedRole` (and the role custom claim) store the roleId slug, which is
 * also the /roles doc id — so the common case is a single targeted `get`
 * instead of scanning the whole collection. Un-migrated legacy docs may still
 * hold the role's displayName; those fall back to a single equality query.
 *
 * Returns the role (with its doc id) or null when nothing matches.
 */
export async function resolveRole(
  db: Firestore,
  roleValue: string,
): Promise<(Role & { id: string }) | null> {
  // Fast path: the slug is the doc id.
  const bySlug = await db.collection(COLLECTIONS.roles).doc(roleValue).get();
  if (bySlug.exists) {
    return { id: bySlug.id, ...(bySlug.data() as Role) };
  }

  // Legacy fallback: match on displayName (single-field equality — no
  // composite index needed).
  const byName = await db
    .collection(COLLECTIONS.roles)
    .where('displayName', '==', roleValue)
    .limit(1)
    .get();
  const doc = byName.docs[0];
  return doc ? { id: doc.id, ...(doc.data() as Role) } : null;
}
