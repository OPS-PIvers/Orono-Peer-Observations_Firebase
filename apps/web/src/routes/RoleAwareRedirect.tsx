import { Navigate } from 'react-router-dom';
import { SPECIAL_ROLES } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Mounted at "/" — sends users to the right landing page based on role.
 *
 * Full Access → /my-rubric
 * Administrator → /my-staff
 * Peer Evaluator → /staff
 * Staff (no special access) → /my-rubric
 */
export function RoleAwareRedirect() {
  const { claims } = useAuth();

  if (!claims.hasSpecialAccess) {
    return <Navigate to="/my-rubric" replace />;
  }

  if (claims.role === SPECIAL_ROLES.administrator) {
    return <Navigate to="/my-staff" replace />;
  }

  if (claims.role === SPECIAL_ROLES.fullAccess) {
    return <Navigate to="/my-rubric" replace />;
  }

  // Peer Evaluator
  return <Navigate to="/staff" replace />;
}
