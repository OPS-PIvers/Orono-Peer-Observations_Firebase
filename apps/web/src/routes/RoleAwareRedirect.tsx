import { Navigate } from 'react-router-dom';
import { SPECIAL_ROLES } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Mounted at "/" — sends users to the right landing page based on role.
 * Administrator → /my-staff (building-scoped working list).
 * Peer Evaluator + Full Access → /staff (district-wide directory).
 * Everyone else → /my-rubric.
 */
export function RoleAwareRedirect() {
  const { claims } = useAuth();

  if (!claims.hasSpecialAccess) {
    return <Navigate to="/my-rubric" replace />;
  }

  if (claims.role === SPECIAL_ROLES.administrator) {
    return <Navigate to="/my-staff" replace />;
  }

  return <Navigate to="/staff" replace />;
}
