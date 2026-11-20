import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';
import { claimsForStaff, type StaffClaims } from './staffClaims.js';

/** How many read → set → re-read rounds before giving up (the caller retries). */
const MAX_ATTEMPTS = 5;

export function sameClaims(a: StaffClaims, b: StaffClaims): boolean {
  return a.role === b.role && a.hasSpecialAccess === b.hasSpecialAccess && a.isAdmin === b.isAdmin;
}

/**
 * Sets `uid`'s custom claims from the LIVE /staff/{email} doc, never from a
 * caller-supplied snapshot, and only returns once a read taken after the
 * write still yields the same claims.
 *
 * Why the re-read: Firestore triggers are delivered unordered and at least
 * once, and syncMyClaims can run at any moment. Two writers that each read
 * the doc and then set claims can interleave so the one holding the OLDER
 * read sets last, restoring revoked access. With the check, whichever
 * writer sets last also reads after every earlier writer's read; if the
 * doc's claims changed since its own read it loops and sets them again, so
 * the final claims always match the live doc.
 *
 * Claims (not updateTime) are compared so unrelated writes to the doc
 * (lastSignInAt, email preferences) can't force extra rounds.
 */
export async function setClaimsFromLiveStaff(
  email: string,
  uid: string,
): Promise<{ claims: StaffClaims; snap: DocumentSnapshot }> {
  const ref = getFirestore().doc(`${COLLECTIONS.staff}/${email}`);
  let snap = await ref.get();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const claims = claimsForStaff(snap.exists ? snap.data() : null);
    await getAuth().setCustomUserClaims(uid, { ...claims });
    const check = await ref.get();
    if (sameClaims(claims, claimsForStaff(check.exists ? check.data() : null))) {
      return { claims, snap: check };
    }
    snap = check;
  }
  throw new Error(`setClaimsFromLiveStaff: staff doc for ${email} kept changing`);
}
