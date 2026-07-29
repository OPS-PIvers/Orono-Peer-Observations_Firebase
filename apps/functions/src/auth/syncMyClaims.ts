import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  ALLOWED_EMAIL_DOMAIN,
  AUDIT_ACTIONS,
  COLLECTIONS,
  isAdminRole,
  isSpecialRole,
} from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Minimum time that must have elapsed since the previous `lastSignInAt`
 * stamp before we write a new one (and a new `sign_in` audit entry). Picked
 * to comfortably exceed how long a legitimate "Refresh access" retry burst
 * or an id-token-refresh-triggered re-sync could plausibly take (seconds,
 * not minutes) while still being short enough that a stamp from an actual
 * new sign-in later the same day is never mistaken for a stale one.
 */
const SIGN_IN_STAMP_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

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
 * Side effect: this is the app's de-facto sign-in path, so it also stamps
 * `staff/{email}.lastSignInAt` and writes an `AUDIT_ACTIONS.signIn`
 * /auditLog entry. The denormalized stamp is what the admin "never signed
 * in" rollout card reads (client-side null-or-missing check, not a
 * Firestore equality filter — see NeverSignedInCard.tsx); the audit entry
 * gives the `sign_in` action, which until now was written nowhere, real
 * data. Both writes are best-effort: a failure is logged but never fails
 * the claim sync, because claims are on the critical path for rendering
 * the app and this bookkeeping is not.
 *
 * Call sites: AuthProvider calls this once per session as soon as a token
 * appears (gated by `syncedUidRef`), plus at most one more call for the
 * one-time isAdmin-claim migration (see AuthProvider.tsx). It is ALSO
 * exposed as `refreshClaims()`, wired to the ungated "Refresh access"
 * button on Unauthorized.tsx — a signed-in user with insufficient access
 * can (and reasonably will) click that repeatedly, and the callable itself
 * only checks `request.auth` + domain, not any role, so it can also be
 * invoked directly in a loop with a valid ID token. Neither path is capped
 * client-side, so the stamp/audit writes below MUST be idempotent against
 * rapid repeats on their own — see the staleness gate.
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

  const db = getFirestore();
  const staffRef = db.doc(`${COLLECTIONS.staff}/${email}`);
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
  //
  // Staleness gate: this callable has an unbounded number of call sites
  // (see header comment — "Refresh access" plus direct callable invocation
  // have no cooldown of their own), so skip the writes entirely when the
  // existing stamp is still fresh. This makes repeated calls within the
  // cooldown a cheap no-op instead of fabricating new sign-in events/audit
  // rows for a sign-in that never happened.
  if (staffSnap.exists) {
    const existingStamp = staffData?.['lastSignInAt'] as
      | { toMillis?: () => number }
      | null
      | undefined;
    const existingMs =
      existingStamp && typeof existingStamp.toMillis === 'function'
        ? existingStamp.toMillis()
        : null;
    const isStale = existingMs === null || Date.now() - existingMs >= SIGN_IN_STAMP_COOLDOWN_MS;

    if (isStale) {
      try {
        await staffRef.update({ lastSignInAt: FieldValue.serverTimestamp() });
        await db.collection(COLLECTIONS.auditLog).add({
          timestamp: FieldValue.serverTimestamp(),
          userEmail: email,
          action: AUDIT_ACTIONS.signIn,
          target: `${COLLECTIONS.staff}/${email}`,
          details: {},
        });
      } catch (err) {
        logger.warn('syncMyClaims: failed to stamp lastSignInAt / write sign_in audit entry', {
          email,
          err,
        });
      }
    }
  }

  return { role, hasSpecialAccess, isAdmin };
});
