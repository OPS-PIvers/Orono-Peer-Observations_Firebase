import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { SPECIAL_ROLES, canCreateObservations } from '@ops/shared';
import { useEffectiveClaims } from '@/dev/DevModeContext';
import { useAdminConsoleAccess } from './adminConsoleAccess';
import { useAuth } from './AuthProvider';

/**
 * Wrap any route element that requires sign-in. Unauthenticated users are
 * redirected to /sign-in with their intended destination preserved in
 * location state so we can bounce them back after login.
 *
 * Optionally `requireAdmin` (Admin Console access — see useAdminConsoleAccess),
 * `requireSpecialAccess`, `requireObserverRole` or `requireAdministrator`
 * enforces role-level access. Failing those redirects to /unauthorized rather than the sign-in
 * screen — they're signed in, just not allowed to view the route.
 */
export interface RequireAuthProps {
  children: ReactNode;
  requireAdmin?: boolean;
  requireSpecialAccess?: boolean;
  /** Role must be able to start observations (see canCreateObservations). */
  requireObserverRole?: boolean;
  /** Role must be Administrator (building-scoped pages like /building-staff). */
  requireAdministrator?: boolean;
}

export function RequireAuth({
  children,
  requireAdmin = false,
  requireSpecialAccess = false,
  requireObserverRole = false,
  requireAdministrator = false,
}: RequireAuthProps) {
  const { status } = useAuth();
  const claims = useEffectiveClaims();
  const location = useLocation();
  const consoleAccess = useAdminConsoleAccess();

  if (status === 'loading' || (requireAdmin && consoleAccess.loading)) {
    return <LoadingSplash />;
  }

  if (status === 'signed-out') {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  if (requireAdmin && !consoleAccess.allowed) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requireSpecialAccess && !claims.hasSpecialAccess) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requireObserverRole && !canCreateObservations(claims.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (requireAdministrator && claims.role !== SPECIAL_ROLES.administrator) {
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
