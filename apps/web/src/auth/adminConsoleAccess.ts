import { COLLECTIONS, SPECIAL_ROLES, type Staff } from '@ops/shared';
import { useDevMode } from '@/dev/DevModeContext';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';

/**
 * Who sees the Admin Console. Narrower than the `isAdmin` claim on purpose:
 * building Administrators carry `isAdmin` so rules and callables let them
 * manage observations and staff, but the console itself (rubrics, roles,
 * email templates, settings) is district/developer territory. They get the
 * building-scoped /my-staff page instead. An Administrator who also has
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
 * claims alone. In dev view-as the viewed person's claims and staff doc
 * decide, so the console shows exactly when it would for them.
 */
export function useAdminConsoleAccess(): { allowed: boolean; loading: boolean } {
  const { effectiveClaims: claims, effectiveEmail } = useDevMode();

  const needsStaffDoc = claims.isAdmin && claims.role === SPECIAL_ROLES.administrator;
  const { data: myStaff, loading } = useFirestoreDoc<Staff>(
    needsStaffDoc && effectiveEmail ? `${COLLECTIONS.staff}/${effectiveEmail}` : '',
  );

  if (!needsStaffDoc) {
    return { allowed: canOpenAdminConsole(claims.role, claims.isAdmin, false), loading: false };
  }
  return {
    allowed: canOpenAdminConsole(claims.role, claims.isAdmin, myStaff?.hasAdminAccess === true),
    loading: loading && !myStaff,
  };
}
