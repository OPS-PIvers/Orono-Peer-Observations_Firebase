import { Navigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';

/**
 * Mounted at "/" — sends users to the right landing page based on role.
 * Special-access roles (Administrator, Peer Evaluator, Full Access) → Dashboard.
 * Everyone else → MyRubric.
 */
export function RoleAwareRedirect() {
  const { claims } = useAuth();
  return claims.hasSpecialAccess ? (
    <Navigate to="/dashboard" replace />
  ) : (
    <Navigate to="/my-rubric" replace />
  );
}
