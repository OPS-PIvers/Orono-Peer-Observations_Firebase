import { beforeUserCreated as authBeforeCreated } from 'firebase-functions/identity';
import { HttpsError } from 'firebase-functions/https';
import { ALLOWED_EMAIL_DOMAIN } from '@ops/shared';

/**
 * Auth blocking function: rejects sign-ins from outside the school domain.
 *
 * This mirrors the GAS app's `appsscript.json` `access: DOMAIN` restriction.
 * Defense-in-depth: Firestore security rules also re-check the email domain
 * via custom claims, so a misconfigured Auth provider cannot leak data.
 *
 * The list of allowed domains lives in @ops/shared so client-side guards
 * stay in sync.
 */
export const beforeUserCreated = authBeforeCreated((event) => {
  const email = event.data?.email;
  if (!email?.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    throw new HttpsError(
      'permission-denied',
      `Sign-in is restricted to @${ALLOWED_EMAIL_DOMAIN} accounts.`,
    );
  }
});
