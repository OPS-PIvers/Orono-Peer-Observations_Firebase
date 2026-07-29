import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { ALLOWED_EMAIL_DOMAIN, COLLECTIONS, isAdminRole, isSpecialRole } from '@ops/shared';

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
 *
 * Side effect: this is the app's de-facto sign-in path — AuthProvider calls
 * it once per session as soon as a token appears — so it also stamps
 * `staff/{email}.lastSignInAt`. That denormalized field is what the admin
 * "never signed in" rollout card queries, instead of grouping /auditLog by
 * user (which Firestore can't do). The stamp is best-effort: a failed write
 * is logged but never fails the claim sync, because claims are on the
 * critical path for rendering the app and adoption telemetry is not.
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

  const staffRef = getFirestore().doc(`${COLLECTIONS.staff}/${email}`);
  const staffSnap = await staffRef.get();
  const staffData = staffSnap.exists ? staffSnap.data() : null;
  const role = (staffData?.['role'] as string | undefined) ?? null;
  const hasAdminAccess = (staffData?.['hasAdminAccess'] as boolean | undefined) ?? false;
  const isAdmin = isAdminRole(role) || hasAdminAccess;
  const hasSpecialAccess = isSpecialRole(role) || isAdmin;

  await getAuth().setCustomUserClaims(request.auth.uid, { role, hasSpecialAccess, isAdmin });
  logger.info('syncMyClaims: claims set', { email, role, hasSpecialAccess, isAdmin });

  // Adoption telemetry — see the note in the header comment. Only stamped
  // when a /staff doc exists (a signed-in account with no roster entry has
  // nothing to stamp). `updatedAt` is deliberately left alone: it tracks
  // admin edits to the roster, not the person's own activity.
  if (staffSnap.exists) {
    try {
      await staffRef.update({ lastSignInAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.warn('syncMyClaims: failed to stamp lastSignInAt', { email, err });
    }
  }

  return { role, hasSpecialAccess, isAdmin };
});
