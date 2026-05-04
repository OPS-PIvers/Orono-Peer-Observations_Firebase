import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SPECIAL_ROLES, isAdminRole, isSpecialRole } from '@ops/shared';
import { useAuth, type AuthClaims } from '@/auth/AuthProvider';

const STORAGE_KEY = 'ops:dev-mode-override';

export type DevRoleOverride =
  | typeof SPECIAL_ROLES.administrator
  | typeof SPECIAL_ROLES.peerEvaluator
  | typeof SPECIAL_ROLES.fullAccess
  | null;

export interface DevModeOverride {
  role: DevRoleOverride;
  building: string | null;
}

interface DevModeContextValue {
  override: DevModeOverride;
  setRole: (role: DevRoleOverride) => void;
  setBuilding: (building: string | null) => void;
  clear: () => void;
  effectiveClaims: AuthClaims;
  isDevUser: boolean;
}

const EMPTY_OVERRIDE: DevModeOverride = { role: null, building: null };

const DevModeContext = createContext<DevModeContextValue | null>(null);

function loadOverride(): DevModeOverride {
  if (typeof window === 'undefined') return EMPTY_OVERRIDE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_OVERRIDE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_OVERRIDE;
    const obj = parsed as Partial<DevModeOverride>;
    const role: DevRoleOverride = isSpecialRole(obj.role ?? null) ? (obj.role ?? null) : null;
    const building =
      typeof obj.building === 'string' && obj.building.length > 0 ? obj.building : null;
    return { role, building };
  } catch {
    return EMPTY_OVERRIDE;
  }
}

export function DevModeProvider({ children }: { children: ReactNode }) {
  const { claims } = useAuth();
  const [override, setOverride] = useState<DevModeOverride>(loadOverride);

  // The dev escape hatch: real Administrators / Full Access / PEs see
  // their actual role and don't need this UI. Only users who have
  // hasAdminAccess flagged on without holding a special role qualify.
  const isDevUser = claims.isAdmin && !isSpecialRole(claims.role);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(override));
    } catch {
      // ignore storage errors
    }
  }, [override]);

  // If the real user stops being a dev (e.g. role change at the server),
  // drop any stored override so it doesn't quietly affect the next session.
  useEffect(() => {
    if (!isDevUser && (override.role !== null || override.building !== null)) {
      setOverride(EMPTY_OVERRIDE);
    }
  }, [isDevUser, override.role, override.building]);

  const setRole = useCallback((role: DevRoleOverride) => {
    setOverride((prev) =>
      role === SPECIAL_ROLES.administrator
        ? { role, building: prev.building }
        : { role, building: null },
    );
  }, []);

  const setBuilding = useCallback((building: string | null) => {
    setOverride((prev) => ({ ...prev, building }));
  }, []);

  const clear = useCallback(() => setOverride(EMPTY_OVERRIDE), []);

  const effectiveClaims = useMemo<AuthClaims>(() => {
    if (!isDevUser || override.role === null) return claims;
    return {
      role: override.role,
      hasSpecialAccess: isSpecialRole(override.role),
      isAdmin: isAdminRole(override.role),
    };
  }, [claims, isDevUser, override.role]);

  const value = useMemo<DevModeContextValue>(
    () => ({ override, setRole, setBuilding, clear, effectiveClaims, isDevUser }),
    [override, setRole, setBuilding, clear, effectiveClaims, isDevUser],
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

/** Returns the effective auth claims with any dev override applied. */
export function useEffectiveClaims(): AuthClaims {
  return useDevMode().effectiveClaims;
}
