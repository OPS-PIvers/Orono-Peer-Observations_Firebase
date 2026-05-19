import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useEffectiveClaims } from '@/dev/DevModeContext';
import { useAuth } from './AuthProvider';

/**
 * Wrap any route element that requires sign-in. Unauthenticated users are
 * redirected to /sign-in with their intended destination preserved in
 * location state so we can bounce them back after login.
 *
 * Optionally `requireAdmin` or `requireSpecialAccess` enforces role-level
 * access. Failing those redirects to /unauthorized rather than the sign-in
 * screen — they're signed in, just not allowed to view the route.
 */
export interface RequireAuthProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireSpecialAccess?: boolean;
  /** Pass when a route should accept either admins OR special-access users.
   *  Used for shared-config surfaces (e.g. dashboard setup) that PEs and
   *  admins co-own — and for the dev-admin escape hatch (hasAdminAccess on
   *  a non-special role) which has isAdmin but not hasSpecialAccess. */
  requireAdminOrSpecialAccess?: boolean;
}

export function RequireAuth({
  children,
  requireAdmin = false,
  requireSpecialAccess = false,
  requireAdminOrSpecialAccess = false,
}: RequireAuthProps) {
  const { status } = useAuth();
  const claims = useEffectiveClaims();
  const location = useLocation();

  if (status === 'loading') {
    return <LoadingSplash />;
  }

  if (status === 'signed-out') {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  if (requireAdmin && !claims.isAdmin) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requireSpecialAccess && !claims.hasSpecialAccess) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requireAdminOrSpecialAccess && !(claims.isAdmin || claims.hasSpecialAccess)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
}

function LoadingSplash() {
  return (
    <div
      className="bg-ops-gray-lightest flex min-h-svh items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="text-muted-foreground text-sm">Loading…</div>
    </div>
  );
}
