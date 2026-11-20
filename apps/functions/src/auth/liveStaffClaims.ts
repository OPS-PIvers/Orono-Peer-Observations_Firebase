import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';
import { claimsForStaff, type StaffClaims } from './staffClaims.js';

/** How many read → set → re-read rounds before giving up (the caller retries). */
const MAX_ATTEMPTS = 5;

/**
 * Whether an Auth user is really the owner of its email: verified, and backed
 * by a Google identity. getUserByEmail/listUsers return any account holding
 * the address, so claims must never be pushed onto an account that merely set
 * a roster address as its (unverified) email. A verified account with no
 * linked provider at all can only have been created server-side (Admin SDK),
 * so it counts. Mirrors hasTrustedEmail (lib/callable.ts) for ID tokens.
 */
export function isTrustedAuthUser(
  user: Pick<UserRecord, 'emailVerified' | 'providerData'>,
): boolean {
  return (
    user.emailVerified &&
    (user.providerData.length === 0 || user.providerData.some((p) => p.providerId === 'google.com'))
  );
}

export function sameClaims(a: StaffClaims, b: StaffClaims): boolean {
  return a.role === b.role && a.hasSpecialAccess === b.hasSpecialAccess && a.isAdmin === b.isAdmin;
}

/** An auth user's stored custom claims, normalized to the triple rules read. */
export function storedClaims(customClaims: Record<string, unknown> | undefined): StaffClaims {
  const c = customClaims ?? {};
  return {
    role: typeof c['role'] === 'string' ? c['role'] : null,
    hasSpecialAccess: c['hasSpecialAccess'] === true,
    isAdmin: c['isAdmin'] === true,
  };
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
 *
 * `current` is the user's stored claims, fetched BEFORE this call. When the
 * live doc already yields them, nothing is written: every writer re-checks
 * after its own write, so stored claims read before our doc read that match
 * it are already correct. Saves an Auth write per no-op staff write.
 */
export async function setClaimsFromLiveStaff(
  email: string,
  uid: string,
  current?: StaffClaims,
): Promise<{ claims: StaffClaims; snap: DocumentSnapshot }> {
  const ref = getFirestore().doc(`${COLLECTIONS.staff}/${email}`);
  let snap = await ref.get();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const claims = claimsForStaff(snap.exists ? snap.data() : null);
    if (attempt === 0 && current && sameClaims(current, claims)) return { claims, snap };
    await getAuth().setCustomUserClaims(uid, { ...claims });
    const check = await ref.get();
    if (sameClaims(claims, claimsForStaff(check.exists ? check.data() : null))) {
      return { claims, snap: check };
    }
    snap = check;
  }
  throw new Error(`setClaimsFromLiveStaff: staff doc for ${email} kept changing`);
}
