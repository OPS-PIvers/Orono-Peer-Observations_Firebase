import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { COLLECTIONS, isAdminRole, isSpecialRole, type Staff } from '@ops/shared';
import { useAuth, type AuthClaims } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import { setViewAsGuard } from './viewAsGuard';

const recordViewAsFn = httpsCallable<{ email: string }, { ok: true }>(functions, 'recordViewAs');

const STORAGE_KEY = 'ops:dev-view-as';
/** The old role-only override. Dropped on load so it can't linger. */
const LEGACY_STORAGE_KEY = 'ops:dev-mode-override';

interface DevModeContextValue {
  /** Email of the staff member being viewed as, or null for your own view. */
  viewAsEmail: string | null;
  /** Their staff doc, once loaded. */
  viewAsStaff: Staff | null;
  /** True until the viewed person's staff doc has loaded. */
  viewAsLoading: boolean;
  setViewAs: (email: string | null) => void;
  clear: () => void;
  /** Claims for whoever the app is rendering as. */
  effectiveClaims: AuthClaims;
  /** Lowercased email of whoever the app is rendering as. */
  effectiveEmail: string;
  isDevUser: boolean;
}

const DevModeContext = createContext<DevModeContextValue | null>(null);

function loadViewAs(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const email = raw?.includes('@') ? raw.toLowerCase() : null;
    // Block writes until the provider's layout effect confirms (or clears)
    // this for a dev user — fail closed.
    setViewAsGuard(email);
    return email;
  } catch {
    return null;
  }
}

/** The claims the server would mint for this staff doc (mirrors
 *  syncMyClaims / onStaffWritten in functions). */
export function claimsForStaff(staff: Pick<Staff, 'role' | 'hasAdminAccess'>): AuthClaims {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
  const isAdmin = isAdminRole(staff.role) || (staff.hasAdminAccess ?? false);
  return { role: staff.role, isAdmin, hasSpecialAccess: isSpecialRole(staff.role) || isAdmin };
}

const LOADING_CLAIMS: AuthClaims = { role: null, hasSpecialAccess: false, isAdmin: false };

/**
 * Dev "view as": a developer picks a real staff member and the whole app
 * renders as them — their claims, staff doc, buildings, rubric, dashboard,
 * modules and observations. Read-only: the signed-in identity never
 * changes, so writes are blocked (see viewAsGuard) and reads rely on the
 * developer's own access.
 */
export function DevModeProvider({ children }: { children: ReactNode }) {
  const { user, claims } = useAuth();
  const [stored, setStored] = useState<string | null>(loadViewAs);

  const realEmail = user?.email?.toLowerCase() ?? '';
  // Who may view as someone: people granted "View As" in Admin Console →
  // Staff (canViewAs on their own staff doc), plus the original developer
  // escape hatch — hasAdminAccess without a special role.
  const { data: realStaff, loading: realStaffLoading } = useFirestoreDoc<Staff>(
    realEmail ? `${COLLECTIONS.staff}/${realEmail}` : '',
  );
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs lack this field
  const grantedViewAs = realStaff?.canViewAs === true && (realStaff.isActive ?? true);
  const isDevUser = grantedViewAs || (claims.isAdmin && !isSpecialRole(claims.role));
  const viewAsEmail = isDevUser && stored && stored !== realEmail ? stored : null;

  const { data: viewAsStaff, loading } = useFirestoreDoc<Staff>(
    viewAsEmail ? `${COLLECTIONS.staff}/${viewAsEmail}` : '',
  );
  // Also "loading" while a stored selection can't be judged yet (claims or
  // the viewer's own staff doc still arriving), so route guards don't act on
  // the viewer's own claims and bounce them before view-as applies.
  const resolvingStored =
    stored !== null && !!realEmail && (claims.role === null || (realStaffLoading && !realStaff));
  const viewAsLoading = resolvingStored || (viewAsEmail !== null && loading && !viewAsStaff);

  // Layout effect: set before any child's useEffect can write. The stored
  // value is applied at module load (see loadViewAs) for the first commit.
  useLayoutEffect(() => {
    setViewAsGuard(viewAsEmail);
  }, [viewAsEmail]);

  useEffect(() => {
    try {
      if (stored) window.localStorage.setItem(STORAGE_KEY, stored);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }, [stored]);

  // If the real user stops being a dev (e.g. role change at the server),
  // drop any stored view-as so it doesn't quietly affect the next session.
  // Only once both the claims and the staff doc have loaded: before then
  // isDevUser reads false for everyone and would wipe a valid selection.
  useEffect(() => {
    if (claims.role !== null && realStaff && !isDevUser && stored !== null) setStored(null);
  }, [claims.role, realStaff, isDevUser, stored]);

  const setViewAs = useCallback((email: string | null) => {
    setStored(email ? email.toLowerCase() : null);
    // Audit trail: every view-as start is logged server-side. Best-effort —
    // a failed log doesn't block the read-only view.
    if (email) {
      recordViewAsFn({ email }).catch((err: unknown) => {
        console.warn('Could not record view-as in the audit log', err);
      });
    }
  }, []);
  const clear = useCallback(() => setStored(null), []);

  const effectiveClaims = useMemo<AuthClaims>(() => {
    if (!viewAsEmail) return claims;
    return viewAsStaff ? claimsForStaff(viewAsStaff) : LOADING_CLAIMS;
  }, [claims, viewAsEmail, viewAsStaff]);

  const value = useMemo<DevModeContextValue>(
    () => ({
      viewAsEmail,
      viewAsStaff: viewAsEmail ? viewAsStaff : null,
      viewAsLoading,
      setViewAs,
      clear,
      effectiveClaims,
      effectiveEmail: viewAsEmail ?? realEmail,
      isDevUser,
    }),
    [
      viewAsEmail,
      viewAsStaff,
      viewAsLoading,
      setViewAs,
      clear,
      effectiveClaims,
      realEmail,
      isDevUser,
    ],
  );

  return <DevModeContext.Provider value={value}>{children}</DevModeContext.Provider>;
}

export function useDevMode(): DevModeContextValue {
  const ctx = useContext(DevModeContext);
  if (!ctx) {
    throw new Error('useDevMode must be called inside <DevModeProvider>');
  }
  return ctx;
}

/** The effective auth claims, as the viewed-as person when one is set. */
export function useEffectiveClaims(): AuthClaims {
  return useDevMode().effectiveClaims;
}

/** Lowercased email of whoever the app is rendering as. Use for every
 *  "me"-shaped read (my staff doc, my observations, my modules). */
export function useEffectiveEmail(): string {
  return useDevMode().effectiveEmail;
}

/** True while viewing as someone else: the UI is read-only. */
export function useIsViewingAs(): boolean {
  return useDevMode().viewAsEmail !== null;
}
