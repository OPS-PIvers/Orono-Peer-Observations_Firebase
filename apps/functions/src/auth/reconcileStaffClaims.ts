import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { COLLECTIONS, isCanonicalStaffEmail } from '@ops/shared';
import { claimsForStaff, type StaffClaims } from './staffClaims.js';
import { sameClaims, setClaimsFromLiveStaff } from './liveStaffClaims.js';

if (getApps().length === 0) initializeApp();

const NO_CLAIMS: StaffClaims = { role: null, hasSpecialAccess: false, isAdmin: false };

/** The claims an auth user carries now, normalized to the triple rules read. */
function currentClaims(user: UserRecord): StaffClaims {
  const c = user.customClaims ?? {};
  return {
    role: typeof c['role'] === 'string' ? c['role'] : null,
    hasSpecialAccess: c['hasSpecialAccess'] === true,
    isAdmin: c['isAdmin'] === true,
  };
}

/**
 * Server-side backstop for claim drift. onStaffWritten and syncMyClaims keep
 * claims in step with /staff, but a lost or failed trigger run, or a client
 * that never calls syncMyClaims, would otherwise leave stale (possibly
 * privileged) claims in place forever. This sweep compares every auth user's
 * claims with the live staff doc (a missing doc means no access) and fixes
 * any mismatch, so drift lasts at most one interval plus the ID token's
 * 1-hour lifetime, with no action from the affected user.
 */
export async function reconcileAllStaffClaims(): Promise<{
  checked: number;
  fixed: number;
  failed: number;
}> {
  const db = getFirestore();
  const auth = getAuth();

  const staffSnap = await db.collection(COLLECTIONS.staff).get();
  const staffByEmail = new Map<string, DocumentData>();
  for (const doc of staffSnap.docs) staffByEmail.set(doc.id, doc.data());

  let checked = 0;
  let fixed = 0;
  let failed = 0;
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      checked++;
      // Same key syncMyClaims / onStaffWritten use: the lowercase email, and
      // only a canonical district address has a staff doc that speaks for it.
      const email = user.email?.toLowerCase();
      const canonical = isCanonicalStaffEmail(email);
      const expected = canonical ? claimsForStaff(staffByEmail.get(email) ?? null) : NO_CLAIMS;
      if (sameClaims(currentClaims(user), expected)) continue;
      try {
        if (canonical) {
          // Re-derives from the live doc, so a write since the bulk read wins.
          await setClaimsFromLiveStaff(email, user.uid);
        } else {
          await auth.setCustomUserClaims(user.uid, { ...NO_CLAIMS });
        }
        fixed++;
        logger.warn('reconcileStaffClaims: corrected drifted claims', { uid: user.uid, email });
      } catch (err) {
        failed++;
        logger.error('reconcileStaffClaims: failed to correct claims', { uid: user.uid, err });
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  return { checked, fixed, failed };
}

export const reconcileStaffClaims = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const result = await reconcileAllStaffClaims();
    logger.info('reconcileStaffClaims: complete', result);
  },
);
