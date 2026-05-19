import { Navigate } from 'react-router-dom';
import { SPECIAL_ROLES } from '@ops/shared';
import { useEffectiveClaims } from '@/dev/DevModeContext';

/**
 * Mounted at "/" — sends users to the right landing page based on role.
 *
 * Administrator → /my-staff
 * Peer Evaluator → /staff
 * Everyone else (plain staff, Full Access without admin claim) → /dashboard
 *
 * Staff land on the new /dashboard (Staff Dashboard) — the year-cycle
 * checklist + materials view. The legacy /my-rubric page is still
 * reachable from the sidebar.
 */
export function RoleAwareRedirect() {
  const claims = useEffectiveClaims();

  if (claims.role === SPECIAL_ROLES.administrator) {
    return <Navigate to="/my-staff" replace />;
  }

  if (claims.role === SPECIAL_ROLES.peerEvaluator) {
    return <Navigate to="/staff" replace />;
  }

  return <Navigate to="/dashboard" replace />;
}
