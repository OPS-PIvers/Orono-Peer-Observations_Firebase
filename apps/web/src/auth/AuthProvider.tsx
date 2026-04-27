import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  onIdTokenChanged,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { isAdminRole, isSpecialRole } from '@ops/shared';
import { auth } from '@/lib/firebase';

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

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (next) => {
      setUser(next);
      if (!next) {
        setClaims(defaultClaims);
        setStatus('signed-out');
      }
    });
    const unsubToken = onIdTokenChanged(auth, (next) => {
      if (!next) return;
      void next.getIdTokenResult().then((result) => {
        const role = (result.claims['role'] as string | undefined) ?? null;
        const hasSpecialAccess =
          (result.claims['hasSpecialAccess'] as boolean | undefined) ?? isSpecialRole(role);
        setClaims({ role, hasSpecialAccess });
        setStatus('signed-in');
      });
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
