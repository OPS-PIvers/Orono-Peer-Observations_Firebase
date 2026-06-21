import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { HttpsCallable } from 'firebase/functions';
import type { User } from 'firebase/auth';
import {
  ALLOWED_EMAIL_DOMAIN,
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  isAdminRole,
  isSpecialRole,
} from '@ops/shared';

// Firebase is imported lazily (dynamic `import()` inside the auth effect and
// the action callbacks below) rather than statically. The Firebase SDK is the
// single heaviest dependency; keeping it off this provider's static module
// graph means the app shell paints before the SDK is even fetched — auth still
// resolves a beat later, which is invisible because the shell starts in a
// 'loading' state regardless.
interface SyncClaimsResult {
  role: string | null;
  hasSpecialAccess: boolean;
  isAdmin: boolean;
}
type SyncClaimsFn = HttpsCallable<Record<string, never>, SyncClaimsResult>;

/** Default session length when appSettings has no explicit value (mirrors the
 *  appSettings schema default). */
const DEFAULT_SESSION_DURATION_HOURS = 24;

/**
 * Enforce the admin-configured maximum session length.
 *
 * Reads `sessionDurationHours` from appSettings/global (defaulting to 24h when
 * absent). If the time since the user's `auth_time` exceeds that limit, signs
 * the user out and returns true; otherwise returns false. A session exactly at
 * the limit is still valid (strict `>`).
 *
 * Fail-open: when the settings doc is missing or Firestore errors, the session
 * is left untouched (returns false) so a transient Firestore problem can never
 * lock everyone out.
 *
 * @param authTimeMs  The user's `auth_time` claim in epoch milliseconds.
 * @returns true when the session was expired and the user signed out.
 */
export async function enforceSessionDuration(authTimeMs: number): Promise<boolean> {
  try {
    const [{ auth, db }, { doc, getDoc }, { signOut: firebaseSignOut }] = await Promise.all([
      import('@/lib/firebase'),
      import('firebase/firestore'),
      import('firebase/auth'),
    ]);
    const settingsSnap = await getDoc(doc(db, `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`));
    if (!settingsSnap.exists()) return false;

    const data = settingsSnap.data();
    const rawHours = (data as { sessionDurationHours?: unknown }).sessionDurationHours;
    const hours = typeof rawHours === 'number' ? rawHours : DEFAULT_SESSION_DURATION_HOURS;
    const limitMs = hours * 60 * 60 * 1000;

    if (Date.now() - authTimeMs > limitMs) {
      await firebaseSignOut(auth);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('enforceSessionDuration failed (fail-open)', err);
    return false;
  }
}

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

  useEffect(() => {
    // Mutable holder (not a bare `let`) so the cleanup closure's write is
    // visible to the async body's read — and so the read isn't flagged as a
    // statically-constant condition.
    const teardown = { cancelled: false };
    let unsubAuth: (() => void) | undefined;
    let unsubToken: (() => void) | undefined;

    void (async () => {
      const [
        { onAuthStateChanged, onIdTokenChanged, signOut: firebaseSignOut },
        { httpsCallable },
        { auth, functions },
      ] = await Promise.all([
        import('firebase/auth'),
        import('firebase/functions'),
        import('@/lib/firebase'),
      ]);
      // The provider may have unmounted during the dynamic import; bail so we
      // don't attach listeners we can never clean up.
      if (teardown.cancelled) return;

      const syncMyClaimsFn: SyncClaimsFn = httpsCallable(functions, 'syncMyClaims');

      unsubAuth = onAuthStateChanged(auth, (next) => {
        // Defense-in-depth domain check: the GoogleAuthProvider's `hd` param
        // restricts the account chooser, but a determined user could still
        // sign in with a non-Orono account. If that happens, kick them out
        // immediately. Firestore rules also enforce the domain.
        if (next && !isAllowedEmail(next.email)) {
          sessionStorage.setItem('signInError.rejectedEmail', next.email ?? '');
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
        }
      });
      unsubToken = onIdTokenChanged(auth, (next) => {
        if (!next) return;
        if (!isAllowedEmail(next.email)) {
          sessionStorage.setItem('signInError.rejectedEmail', next.email ?? '');
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

          // The token round-trip is async; if the provider unmounted while it
          // was in flight, skip the state updates to avoid touching an
          // unmounted tree.
          if (teardown.cancelled) return;
          const isAdmin = rawIsAdmin ?? isAdminRole(role);
          setClaims({ role, hasSpecialAccess, isAdmin });
          setStatus('signed-in');
        })();
      });
    })();

    return () => {
      teardown.cancelled = true;
      unsubAuth?.();
      unsubToken?.();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      claims,
      signOut: async () => {
        const [{ signOut: firebaseSignOut }, { auth }] = await Promise.all([
          import('firebase/auth'),
          import('@/lib/firebase'),
        ]);
        await firebaseSignOut(auth);
      },
      refreshClaims: async () => {
        const [{ httpsCallable }, { auth, functions }] = await Promise.all([
          import('firebase/functions'),
          import('@/lib/firebase'),
        ]);
        if (!auth.currentUser) return;
        const syncMyClaimsFn: SyncClaimsFn = httpsCallable(functions, 'syncMyClaims');
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
