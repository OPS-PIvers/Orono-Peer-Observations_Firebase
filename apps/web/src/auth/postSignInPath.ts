export interface SignInLocationState {
  /** Set by AuthProvider's PLAT-09 session-timeout enforcement when the
   *  configured session duration was exceeded and the user was force
   *  signed-out. */
  sessionExpired?: boolean;
  /** Where RequireAuth bounced the user from — e.g. an email's
   *  "Acknowledge receipt" link — so sign-in can return them there. */
  from?: { pathname?: string; search?: string; hash?: string };
}

/**
 * The in-app path to land on after sign-in: the page RequireAuth bounced the
 * user from (query + hash kept, so `?ack=1` survives), else the home route.
 * Only single-slash paths are accepted, never `//host` or a full URL.
 */
export function postSignInPath(state: SignInLocationState | null): string {
  const from = state?.from;
  const pathname = from?.pathname ?? '';
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname === '/sign-in') {
    return '/';
  }
  return `${pathname}${from?.search ?? ''}${from?.hash ?? ''}`;
}
