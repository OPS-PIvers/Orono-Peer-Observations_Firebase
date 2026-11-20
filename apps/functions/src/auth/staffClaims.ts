import { CLAIMS_EMAIL_CLAIM, isAdminRole, isSpecialRole } from '@ops/shared';

/** The custom claims every rule and callable reads. */
export interface StaffClaims {
  role: string | null;
  hasSpecialAccess: boolean;
  isAdmin: boolean;
}

/**
 * Claims for a raw /staff doc (or null when there is none). An archived
 * member (`isActive: false`) gets no role and no access: archiving only sets
 * that flag and leaves `role` / `hasAdminAccess` on the doc, so deriving from
 * those alone would re-mint their old access. `isActive` defaults to true, so
 * a legacy doc without the field still counts as active.
 *
 * Shared by onStaffWritten and syncMyClaims so the two can't drift.
 */
export function claimsForStaff(
  staff: { role?: string | null; hasAdminAccess?: boolean; isActive?: boolean } | null | undefined,
): StaffClaims {
  if (!staff || staff.isActive === false) {
    return { role: null, hasSpecialAccess: false, isAdmin: false };
  }
  const role = staff.role ?? null;
  const isAdmin = isAdminRole(role) || (staff.hasAdminAccess ?? false);
  return { role, hasSpecialAccess: isSpecialRole(role) || isAdmin, isAdmin };
}

/**
 * The custom claims to store on an Auth user: the staff claims plus
 * CLAIMS_EMAIL_CLAIM, the /staff doc id they were derived from. Claims sit on
 * the uid but are issued and revoked by email, so the rules and functions
 * only honour them while the token's email still equals this.
 */
export function boundClaims(
  claims: StaffClaims,
  email: string,
): StaffClaims & { [CLAIMS_EMAIL_CLAIM]: string } {
  return { ...claims, [CLAIMS_EMAIL_CLAIM]: email };
}
