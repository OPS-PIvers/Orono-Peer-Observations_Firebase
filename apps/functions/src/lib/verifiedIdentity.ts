import { ALLOWED_EMAIL_DOMAIN, DEMO_EDIT_CLAIM } from '@ops/shared';

type TokenLike = Record<string, unknown>;

/**
 * Whether a decoded ID token proves ownership of its district email.
 *
 * A bare `token.email` string is NOT proof of identity: depending on the Auth
 * project's settings an account can carry an email it never verified. We
 * require the email to be verified AND asserted by the Google identity for that
 * same address. The only other accepted sign-in is a server-minted custom token
 * for a View As + Edit session (carries DEMO_EDIT_CLAIM, minted by
 * startViewAsEdit for an existing, Google-verified account).
 */
export function verifiedDistrictEmail(token: TokenLike | null | undefined): string | null {
  if (!token) return null;
  const raw = token['email'];
  if (typeof raw !== 'string') return null;
  const email = raw.toLowerCase();
  if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) return null;
  if (token['email_verified'] !== true) return null;

  const firebase = token['firebase'] as
    { sign_in_provider?: unknown; identities?: Record<string, unknown> } | undefined;
  const provider = firebase?.sign_in_provider;
  if (provider === 'custom') {
    // Server-minted tokens only: demo-edit sessions, or the dev-auth-server's
    // devSignIn marker (needs service-account signing, like demo-edit).
    return typeof token[DEMO_EDIT_CLAIM] === 'string' || token['devSignIn'] === true
      ? email
      : null;
  }
  // Google asserts email_verified for the address it signed in; changing the
  // email afterwards resets email_verified to false, so both must hold.
  if (provider !== 'google.com') return null;
  const googleIds = firebase?.identities?.['google.com'];
  return Array.isArray(googleIds) && googleIds.length > 0 ? email : null;
}
