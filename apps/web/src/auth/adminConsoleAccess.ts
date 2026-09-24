import { COLLECTIONS, SPECIAL_ROLES, type Staff } from '@ops/shared';
import { useDevMode } from '@/dev/DevModeContext';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useAuth } from './AuthProvider';

/**
 * Who sees the Admin Console. Narrower than the `isAdmin` claim on purpose:
 * building Administrators carry `isAdmin` so rules and callables let them
 * manage observations and staff, but the console itself (rubrics, roles,
 * email templates, settings) is district/developer territory. They get the
 * building-scoped /building-staff page instead. An Administrator who also has
 * the `hasAdminAccess` staff flag still gets the console.
 */
export function canOpenAdminConsole(
  role: string | null,
  isAdmin: boolean,
  hasAdminAccess: boolean,
): boolean {
  if (!isAdmin) return false;
  if (role === SPECIAL_ROLES.administrator) return hasAdminAccess;
  return true;
}

/**
 * `loading` is true only while an Administrator's own staff doc is still
 * being read to check `hasAdminAccess`; every other caller resolves from
 * claims alone. A dev-mode role override is judged on the override role
 * only, so impersonating an Administrator hides the console like it would
 * for a real one.
 */
export function useAdminConsoleAccess(): { allowed: boolean; loading: boolean } {
  const { user } = useAuth();
  const { override, effectiveClaims: claims } = useDevMode();

  const needsStaffDoc =
    override.role === null && claims.isAdmin && claims.role === SPECIAL_ROLES.administrator;
  const email = needsStaffDoc ? (user?.email?.toLowerCase() ?? '') : '';
  const { data: myStaff, loading } = useFirestoreDoc<Staff>(
    email ? `${COLLECTIONS.staff}/${email}` : '',
  );

  if (!needsStaffDoc) {
    return { allowed: canOpenAdminConsole(claims.role, claims.isAdmin, false), loading: false };
  }
  return {
    allowed: canOpenAdminConsole(claims.role, claims.isAdmin, myStaff?.hasAdminAccess === true),
    loading: loading && !myStaff,
  };
}
