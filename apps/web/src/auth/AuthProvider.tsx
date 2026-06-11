import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import {
  ALLOWED_EMAIL_DOMAIN,
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  isAdminRole,
  isSpecialRole,
} from '@ops/shared';
import { auth, db, functions } from '@/lib/firebase';

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

const syncMyClaimsFn = httpsCallable<
  Record<string, never>,
  { role: string | null; hasSpecialAccess: boolean; isAdmin: boolean }
>(functions, 'syncMyClaims');

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
    const unsubAuth = onAuthStateChanged(auth, (next) => {
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
    const unsubToken = onIdTokenChanged(auth, (next) => {
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
