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
  getRedirectResult,
  onAuthStateChanged,
  onIdTokenChanged,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { ALLOWED_EMAIL_DOMAIN, isAdminRole, isSpecialRole } from '@ops/shared';
import { auth, functions } from '@/lib/firebase';

const syncMyClaimsFn = httpsCallable<
  Record<string, never>,
  { role: string | null; hasSpecialAccess: boolean }
>(functions, 'syncMyClaims');

export interface AuthClaims {
  role: string | null;
  hasSpecialAccess: boolean;
}

export interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in';
  user: User | null;
  claims: AuthClaims;
  signOut: () => Promise<void>;
  /** Force a token refresh (after admin role change). */
  refreshClaims: () => Promise<void>;
}

const defaultClaims: AuthClaims = { role: null, hasSpecialAccess: false };

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<AuthClaims>(defaultClaims);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  /** UID we've already synced claims for this session, to avoid spamming
   *  the callable on every token refresh. */
  const syncedUidRef = useRef<string | null>(null);

  useEffect(() => {
    // Surface any pending redirect-based sign-in (Google OAuth via
    // signInWithRedirect bounces back here on the next page load). We
    // don't need to do anything with the result — onAuthStateChanged
    // and onIdTokenChanged below pick up the new user automatically.
    // Errors are logged for diagnostics but never throw.
    void getRedirectResult(auth).catch((err: unknown) => {
      console.warn('redirect sign-in failed', err);
    });

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
      }
    });
    const unsubToken = onIdTokenChanged(auth, (next) => {
      if (!next) return;
      if (!isAllowedEmail(next.email)) {
        void firebaseSignOut(auth);
        return;
      }
      void (async () => {
        // First sign-in this session: synchronously sync claims and
        // refresh the token before flipping status to 'signed-in'.
        // Without this gate, RequireAuth-protected routes mount Firestore
        // listeners with a no-claims token; rules deny; the listener
        // captures the error and never auto-recovers.
        const isFirstSignIn = syncedUidRef.current !== next.uid;
        if (isFirstSignIn) {
          syncedUidRef.current = next.uid;
          try {
            await syncMyClaimsFn({});
            await next.getIdToken(true);
          } catch (err) {
            console.warn('syncMyClaims failed', err);
          }
        }

        const result = await next.getIdTokenResult();
        const role = (result.claims['role'] as string | undefined) ?? null;
        const hasSpecialAccess =
          (result.claims['hasSpecialAccess'] as boolean | undefined) ?? isSpecialRole(role);
        setClaims({ role, hasSpecialAccess });
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
  return isAdminRole(claims.role);
}

export function useHasSpecialAccess(): boolean {
  const { claims } = useAuth();
  return claims.hasSpecialAccess;
}

function isAllowedEmail(email: string | null): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}
