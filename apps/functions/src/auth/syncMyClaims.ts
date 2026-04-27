import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ALLOWED_EMAIL_DOMAIN, COLLECTIONS, isSpecialRole } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Callable function the client invokes after sign-in to sync the caller's
 * custom auth claims (`role`, `hasSpecialAccess`) from their `/staff/{email}`
 * doc.
 *
 * Background: Firebase Auth blocking functions (which would normally do this
 * server-side at user-creation time) require Identity Platform / GCIP, a
 * paid tier. On the Spark plan we set claims via this callable instead.
 *
 * Domain enforcement is layered:
 *   1) `hd` parameter on the Google sign-in provider (client SignInScreen)
 *   2) AuthProvider's post-sign-in email check (signs out non-domain users)
 *   3) `isFromOronoDomain()` guard inside every Firestore rule
 *   4) This function (refuses to issue claims to non-domain accounts)
 */
export const syncMyClaims = onCall({ region: 'us-central1', memory: '256MiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const email = request.auth.token.email?.toLowerCase();
  if (!email?.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    throw new HttpsError(
      'permission-denied',
      `Sign-in is restricted to @${ALLOWED_EMAIL_DOMAIN} accounts.`,
    );
  }

  const staffSnap = await getFirestore().doc(`${COLLECTIONS.staff}/${email}`).get();
  const role = staffSnap.exists
    ? ((staffSnap.data()?.['role'] as string | undefined) ?? null)
    : null;
  const hasSpecialAccess = isSpecialRole(role);

  await getAuth().setCustomUserClaims(request.auth.uid, { role, hasSpecialAccess });
  logger.info('syncMyClaims: claims set', { email, role, hasSpecialAccess });
  return { role, hasSpecialAccess };
});
