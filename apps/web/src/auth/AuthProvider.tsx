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
import { useNavigate } from 'react-router-dom';
import {
  onAuthStateChanged,
  onIdTokenChanged,
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
   *  (unlike a localStorage timestamp) since it's minted server-side. */
  const authTimeMsRef = useRef<number | null>(null);
  /** Set by "Stay signed in" — see sessionTimeout.ts for why this can't just
   *  be derived from a refreshed ID token. */
  const extendedUntilMsRef = useRef<number | null>(null);
  const sessionDurationMsRef = useRef<number>(DEFAULT_SESSION_DURATION_HOURS * HOURS_TO_MS);
  const [sessionWarningRemainingMs, setSessionWarningRemainingMs] = useState<number | null>(null);

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

  const forceSignOutForTimeout = useCallback(() => {
    void (async () => {
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
      try {
        // Per owner spec: refresh the ID token itself. Note this alone does
        // NOT move the auth_time-based deadline (see sessionTimeout.ts) —
        // the extendedUntilMsRef line below is what actually buys more time.
        await current.getIdToken(true);
        const result = await current.getIdTokenResult();
        authTimeMsRef.current = Date.parse(result.authTime);
      } catch (err) {
        console.warn('Failed to refresh ID token for "Stay signed in"', err);
      }
      extendedUntilMsRef.current = Date.now() + sessionDurationMsRef.current;
      setSessionWarningRemainingMs(null);
    })();
  }, []);

  // Poll for the session deadline. Re-checks immediately on window focus and
  // tab visibility change (not just the interval) so a backgrounded iPad
  // tab can't silently sail past the deadline while unattended, and so the
  // countdown/forced-signout reacts promptly the moment someone comes back.
  useEffect(() => {
    if (status !== 'signed-in') {
      setSessionWarningRemainingMs(null);
      return;
    }
    function check() {
      if (!auth.currentUser) return;
      const authTimeMs = authTimeMsRef.current;
      if (authTimeMs == null) return;
      const result = computeSessionTimeoutStatus({
        authTimeMs,
        sessionDurationMs: sessionDurationMsRef.current,
        extendedUntilMs: extendedUntilMsRef.current,
        nowMs: Date.now(),
      });
      if (result.kind === 'expired') {
        setSessionWarningRemainingMs(null);
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
        extendedUntilMsRef.current = null;
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
          // A new sign-in starts a fresh session-duration window; drop any
          // extension granted during a previous session in this tab.
          extendedUntilMsRef.current = null;
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

  return (
    <AuthContext.Provider value={value}>
      {status === 'signed-in' && sessionWarningRemainingMs != null ? (
        <SessionTimeoutBanner
          remainingMs={sessionWarningRemainingMs}
          onStaySignedIn={staySignedIn}
        />
      ) : null}
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Fixed, non-dismissible countdown banner shown ~5 minutes before the
 * configured session duration expires. Deliberately has no close button —
 * unlike GlobalBanner (an admin announcement), acting on this one actually
 * matters, so it stays until the user clicks "Stay signed in" or the
 * deadline passes and they're signed out.
 */
function SessionTimeoutBanner({
  remainingMs,
  onStaySignedIn,
}: {
  remainingMs: number;
  onStaySignedIn: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="border-ops-red bg-ops-red-lighter text-ops-red-dark fixed inset-x-0 top-0 z-50 flex flex-wrap items-center justify-center gap-3 border-b-2 px-4 py-3 text-center text-sm font-medium shadow-sm"
    >
      <span>Your session will expire in {formatRemaining(remainingMs)}.</span>
      <Button size="sm" onClick={onStaySignedIn}>
        Stay signed in
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
