import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  onIdTokenChanged,
  reauthenticateWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import {
  ALLOWED_EMAIL_DOMAIN,
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  isAdminRole,
  isSpecialRole,
  type AppSettings,
} from '@ops/shared';
import { auth, functions } from '@/lib/firebase';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { Button } from '@/components/ui/button';
import { DialogInterruptProvider, useHasOpenDialogLayer } from '@/components/ui/dialog-interrupt';
import { cn } from '@/lib/utils';
import { runForcedSignOutFlush } from './forcedSignOutFlush';
import {
  DEFAULT_SESSION_DURATION_HOURS,
  SESSION_CHECK_INTERVAL_MS,
  computeSessionTimeoutStatus,
  formatRemaining,
} from './sessionTimeout';

const syncMyClaimsFn = httpsCallable<
  Record<string, never>,
  { role: string | null; hasSpecialAccess: boolean; isAdmin: boolean }
>(functions, 'syncMyClaims');

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;
const HOURS_TO_MS = 60 * 60 * 1000;

export interface AuthClaims {
  role: string | null;
  hasSpecialAccess: boolean;
  /** True for Administrator/Full Access roles and any staff with hasAdminAccess flag. */
  isAdmin: boolean;
}

export interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in';
  user: User | null;
  claims: AuthClaims;
  signOut: () => Promise<void>;
  /** Force a token refresh (after admin role change). */
  refreshClaims: () => Promise<void>;
}

const defaultClaims: AuthClaims = { role: null, hasSpecialAccess: false, isAdmin: false };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<AuthClaims>(defaultClaims);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  /** UID we've already synced claims for this session, to avoid spamming
   *  the callable on every token refresh. */
  const syncedUidRef = useRef<string | null>(null);
  /** True once we've performed a migration re-sync to pick up the isAdmin
   *  claim that old tokens (pre-hasAdminAccess) may not carry. */
  const isAdminMigrationDoneRef = useRef(false);

  // --- PLAT-09: enforce appSettings.sessionDurationHours (soft, client-side) ---
  const navigate = useNavigate();
  /** The signed-in token's `auth_time` claim, epoch ms. Not user-tamperable
   *  (unlike a localStorage timestamp) since it's minted server-side, and
   *  it's the ONLY thing that ever moves the deadline — see
   *  sessionTimeout.ts and `staySignedIn` below. */
  const authTimeMsRef = useRef<number | null>(null);
  const sessionDurationMsRef = useRef<number>(DEFAULT_SESSION_DURATION_HOURS * HOURS_TO_MS);
  const [sessionWarningRemainingMs, setSessionWarningRemainingMs] = useState<number | null>(null);
  /** True while a "Stay signed in" re-auth popup is in flight. */
  const [reauthPending, setReauthPending] = useState(false);
  /** Set when the re-auth popup was dismissed, blocked, or otherwise
   *  failed. Cleared on the next attempt or on success. The warning
   *  banner stays up (and the countdown keeps running against the real
   *  auth_time-based deadline) — the user can just try again. */
  const [reauthError, setReauthError] = useState<string | null>(null);
  /** While a Dialog/Sheet is open the warning renders inside it instead of in
   *  the page-level portal, so it's never shown (or announced) twice. */
  const hasOpenDialogLayer = useHasOpenDialogLayer();

  // Only subscribe once signed in — the doc is Orono-domain-readable, not
  // public, and there's nothing to enforce before a session exists anyway.
  const { data: appSettingsData } = useFirestoreDoc<AppSettings>(
    status === 'signed-in' ? SETTINGS_PATH : '',
  );

  useEffect(() => {
    // Firestore reads via the Admin/client SDK bypass Zod defaults, so a doc
    // predating this field (or the pre-load `null`) surfaces `undefined` —
    // fall back explicitly to the schema default (24h).
    const hours = appSettingsData?.sessionDurationHours ?? DEFAULT_SESSION_DURATION_HOURS;
    sessionDurationMsRef.current = hours * HOURS_TO_MS;
  }, [appSettingsData]);

  /** Guards against a second deadline check (interval, focus, visibility)
   *  re-entering while the flush below is still running. */
  const forcedSignOutInFlightRef = useRef(false);

  const forceSignOutForTimeout = useCallback(() => {
    if (forcedSignOutInFlightRef.current) return;
    forcedSignOutInFlightRef.current = true;
    void (async () => {
      try {
        // Land any debounced editor write FIRST, while the token is still
        // valid. Signing out and then navigating unmounts the observation
        // editor, and its unmount flush would run against a null
        // `auth.currentUser` — silently dropping up to AUTOSAVE_DEBOUNCE_MS
        // of work (a rubric toggle, a keystroke, freshly applied auto-tags).
        // The wait is bounded inside runForcedSignOutFlush, so this cannot
        // weaken the deadline: sign-out happens regardless of what the
        // flushes do. See forcedSignOutFlush.ts.
        await runForcedSignOutFlush();
      } catch (err) {
        console.warn('Pending-work flush before forced sign-out failed', err);
      }
      try {
        await firebaseSignOut(auth);
      } finally {
        void navigate('/sign-in', { replace: true, state: { sessionExpired: true } });
      }
    })();
  }, [navigate]);

  const staySignedIn = useCallback(() => {
    void (async () => {
      const current = auth.currentUser;
      if (!current) return;
      setReauthError(null);
      setReauthPending(true);
      try {
        // OWNER DECISION: genuinely re-authenticate rather than tracking a
        // client-side "extended until" anchor. A plain ID-token refresh
        // (`getIdToken(true)`) does NOT change the `auth_time` claim —
        // Firebase only stamps a new `auth_time` on real re-auth — so this
        // is the only way "Stay signed in" can actually move the deadline
        // instead of being a client assertion a shared/lab-device user
        // could exploit to extend their session forever.
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ hd: ALLOWED_EMAIL_DOMAIN });
        const credential = await reauthenticateWithPopup(current, provider);
        const result = await credential.user.getIdTokenResult();
        authTimeMsRef.current = Date.parse(result.authTime);
        // Optimistic clear: the poll below would pick this up within
        // SESSION_CHECK_INTERVAL_MS anyway, but there's no reason to make
        // the user wait to see the banner go away after a successful reauth.
        setSessionWarningRemainingMs(null);
      } catch (err) {
        // Popup dismissed/blocked, or any other reauth failure: leave
        // authTimeMsRef untouched (there's exactly one source of truth for
        // the deadline, and none of these paths get to move it) and leave
        // the warning banner up so the user can retry, or be signed out for
        // real once the actual deadline arrives.
        const code = (err as { code?: string } | null)?.code;
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          setReauthError('Sign-in was cancelled. Try again before your session expires.');
        } else if (code === 'auth/popup-blocked') {
          setReauthError('Your browser blocked the sign-in popup. Allow popups and try again.');
        } else {
          console.warn('Failed to re-authenticate for "Stay signed in"', err);
          setReauthError('Could not verify your identity. Try again.');
        }
      } finally {
        setReauthPending(false);
      }
    })();
  }, []);

  // Poll for the session deadline. Re-checks immediately on window focus and
  // tab visibility change (not just the interval) so a backgrounded iPad
  // tab can't silently sail past the deadline while unattended, and so the
  // countdown/forced-signout reacts promptly the moment someone comes back.
  useEffect(() => {
    if (status !== 'signed-in') {
      setSessionWarningRemainingMs(null);
      setReauthError(null);
      // Signing in again (same mount) must re-arm the forced sign-out.
      forcedSignOutInFlightRef.current = false;
      return;
    }
    function check() {
      if (!auth.currentUser) return;
      const authTimeMs = authTimeMsRef.current;
      if (authTimeMs == null) return;
      const result = computeSessionTimeoutStatus({
        authTimeMs,
        sessionDurationMs: sessionDurationMsRef.current,
        nowMs: Date.now(),
      });
      if (result.kind === 'expired') {
        setSessionWarningRemainingMs(null);
        setReauthError(null);
        forceSignOutForTimeout();
        return;
      }
      setSessionWarningRemainingMs(result.kind === 'warning' ? result.remainingMs : null);
    }
    check();
    const intervalId = window.setInterval(check, SESSION_CHECK_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [status, forceSignOutForTimeout]);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (next) => {
      // Defense-in-depth domain check: the GoogleAuthProvider's `hd` param
      // restricts the account chooser, but a determined user could still
      // sign in with a non-Orono account. If that happens, kick them out
      // immediately. Firestore rules also enforce the domain.
      if (next && !isAllowedEmail(next.email)) {
        void firebaseSignOut(auth);
        return;
      }
      setUser(next);
      if (next) {
        // Hold the UI in 'loading' until onIdTokenChanged finishes the
        // claim-sync round-trip below. Without this, RequireAuth sees a
        // 'signed-out' status during the React batch between sign-in and
        // the first token callback, and bounces the user to /sign-in
        // mid-redirect.
        setStatus((prev) => (prev === 'signed-out' ? 'loading' : prev));
      } else {
        setClaims(defaultClaims);
        setStatus('signed-out');
        syncedUidRef.current = null;
        authTimeMsRef.current = null;
      }
    });
    const unsubToken = onIdTokenChanged(auth, (next) => {
      if (!next) return;
      if (!isAllowedEmail(next.email)) {
        void firebaseSignOut(auth);
        return;
      }
      void (async () => {
        // First sign-in this session: sync claims and refresh the token
        // before flipping status to 'signed-in'. Without this gate,
        // RequireAuth-protected routes mount Firestore listeners with a
        // no-claims token; rules deny; the listener captures the error and
        // never auto-recovers.
        const isFirstSignIn = syncedUidRef.current !== next.uid;
        if (isFirstSignIn) {
          syncedUidRef.current = next.uid;
          try {
            await syncMyClaimsFn({});
            await next.getIdToken(true);
            // Intentionally fall through. Returning here would leave
            // status='loading' if Firebase doesn't re-fire onIdTokenChanged
            // (which it skips when the force-refreshed token is identical
            // to the one already cached). Falling through reads the fresh
            // token via getIdTokenResult() below and sets status directly.
            // The second onIdTokenChanged (if it does fire) harmlessly
            // re-sets the same claims.
          } catch (err) {
            console.warn('syncMyClaims failed', err);
            // Fall through: set claims from the current (possibly stale) token.
          }
        }

        const result = await next.getIdTokenResult();
        // Anchor for the session-duration clock (see sessionTimeout.ts).
        authTimeMsRef.current = Date.parse(result.authTime);
        const role = (result.claims['role'] as string | undefined) ?? null;
        const hasSpecialAccess =
          (result.claims['hasSpecialAccess'] as boolean | undefined) ?? isSpecialRole(role);
        const rawIsAdmin =
          typeof result.claims['isAdmin'] === 'boolean' ? result.claims['isAdmin'] : undefined;

        // Migration: tokens issued before the hasAdminAccess feature landed
        // don't carry an `isAdmin` claim. Re-sync once per session so a staff
        // member whose hasAdminAccess flag was set in Firestore gets their
        // claim without having to sign out and back in.
        if (rawIsAdmin === undefined && !isAdminMigrationDoneRef.current) {
          isAdminMigrationDoneRef.current = true;
          try {
            await syncMyClaimsFn({});
            await next.getIdToken(true);
            // onIdTokenChanged will fire again with the refreshed token; bail
            // here so we don't set stale claims before that second call.
            return;
          } catch (err) {
            console.warn('syncMyClaims migration sync failed', err);
            // Fall through: set claims with role-based fallback below.
          }
        }

        const isAdmin = rawIsAdmin ?? isAdminRole(role);
        setClaims({ role, hasSpecialAccess, isAdmin });
        setStatus('signed-in');
      })();
    });
    return () => {
      unsubAuth();
      unsubToken();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      claims,
      signOut: () => firebaseSignOut(auth),
      refreshClaims: async () => {
        if (!auth.currentUser) return;
        try {
          await syncMyClaimsFn({});
        } catch (err) {
          console.warn('syncMyClaims failed during refreshClaims', err);
        }
        await auth.currentUser.getIdToken(true);
      },
    }),
    [status, user, claims],
  );

  const warningVisible = status === 'signed-in' && sessionWarningRemainingMs != null;

  return (
    <AuthContext.Provider value={value}>
      {/* Two placements, never both at once: while a modal layer is open the
          warning renders INSIDE it (the only place that's above the overlay,
          inside Radix's pointer-events island and focus trap, and outside its
          aria-hidden subtree); otherwise it rides in its own top-of-page
          portal. See dialog-interrupt.tsx. The provider itself is
          unconditional — moving `children` in and out of it would remount the
          whole app every time the warning appeared. */}
      <DialogInterruptProvider
        content={
          warningVisible ? (
            <SessionTimeoutBanner
              placement="dialog"
              remainingMs={sessionWarningRemainingMs}
              onStaySignedIn={staySignedIn}
              pending={reauthPending}
              error={reauthError}
            />
          ) : null
        }
      >
        {warningVisible && !hasOpenDialogLayer ? (
          <SessionTimeoutBannerPortal>
            <SessionTimeoutBanner
              placement="page"
              remainingMs={sessionWarningRemainingMs}
              onStaySignedIn={staySignedIn}
              pending={reauthPending}
              error={reauthError}
            />
          </SessionTimeoutBannerPortal>
        ) : null}
        {children}
      </DialogInterruptProvider>
    </AuthContext.Provider>
  );
}

/**
 * Portals the page-level banner to `<body>` at a z-index above the `z-50`
 * overlay/popover layer, rather than leaving it in document order where the
 * sticky AppHeader (also `z-50`, but later in the DOM) paints over it.
 */
function SessionTimeoutBannerPortal({ children }: { children: ReactNode }) {
  return createPortal(
    <div
      // `pointer-events-none` on the wrapper so the strip either side of the
      // banner never swallows clicks meant for the page.
      //
      // `aria-live` is load-bearing, not decoration: the aria-hidden library
      // Radix uses to hide the rest of the page behind a modal deliberately
      // exempts `[aria-live]` elements, so this container survives a modal
      // that doesn't route through DialogInterruptSlot (a modal dropdown
      // menu, say) opening on top of the warning. "off" because the alert
      // inside is already the live region; a second one would double-announce.
      aria-live="off"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60]"
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Non-dismissible countdown shown ~5 minutes before the configured session
 * duration expires. Deliberately has no close button — unlike GlobalBanner
 * (an admin announcement), acting on this one actually matters, so it stays
 * until the user clicks "Stay signed in" or the deadline passes and they're
 * signed out.
 *
 * `placement="page"` is the full-bleed bar across the top of the app;
 * `placement="dialog"` is the same alert as a DESIGN.md warning callout at the
 * top of an open dialog's content.
 */
function SessionTimeoutBanner({
  remainingMs,
  onStaySignedIn,
  pending,
  error,
  placement,
}: {
  remainingMs: number;
  onStaySignedIn: () => void;
  pending: boolean;
  error: string | null;
  placement: 'page' | 'dialog';
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'border-ops-red bg-ops-red-lighter text-ops-red-dark pointer-events-auto flex flex-wrap items-center justify-center gap-3 px-4 py-3 text-center text-sm font-medium',
        placement === 'page'
          ? 'border-b-2 shadow-sm'
          : // Sticky so a long dialog (the auto-tag review list) can't scroll
            // the warning out of sight, and pr-10 to clear the dialog's
            // absolutely-positioned close button.
            'sticky top-0 z-10 rounded-md border-l-[3px] pr-10',
      )}
    >
      <span>
        Your session will expire in {formatRemaining(remainingMs)}
        {error ? `. ${error}` : '.'}
      </span>
      <Button size="sm" onClick={onStaySignedIn} disabled={pending}>
        {pending ? 'Verifying…' : error ? 'Try again' : 'Stay signed in'}
      </Button>
    </div>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be called inside <AuthProvider>');
  }
  return ctx;
}

/** Convenience helpers for route guards. */
export function useIsAdmin(): boolean {
  const { claims } = useAuth();
  return claims.isAdmin;
}

export function useHasSpecialAccess(): boolean {
  const { claims } = useAuth();
  return claims.hasSpecialAccess;
}

function isAllowedEmail(email: string | null): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}
