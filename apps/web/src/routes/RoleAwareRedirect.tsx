import { Navigate } from 'react-router-dom';
import { SPECIAL_ROLES } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { FA_MODE_KEY } from '@/components/AppSidebar';

/**
 * Mounted at "/" — sends users to the right landing page based on role.
 *
 * Full Access: mode toggle persists in localStorage.
 *   'staff'  → /my-rubric  (My View)
 *   'admin'  → /staff      (Admin View, default)
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
    let mode = 'admin';
    try {
      mode = localStorage.getItem(FA_MODE_KEY) ?? 'admin';
    } catch {
      // ignore
    }
    return <Navigate to={mode === 'staff' ? '/my-rubric' : '/staff'} replace />;
  }

  // Peer Evaluator
  return <Navigate to="/staff" replace />;
}
