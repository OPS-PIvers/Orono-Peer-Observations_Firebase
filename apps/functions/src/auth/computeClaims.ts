import { isAdminRole, isSpecialRole } from '@ops/shared';

/** Custom auth claims issued to every signed-in staff member. */
export interface StaffClaims {
  role: string | null;
  hasSpecialAccess: boolean;
  isAdmin: boolean;
}

/** The subset of /staff/{email} fields that drive claim computation. */
export interface StaffClaimSource {
  role?: string | null;
  hasAdminAccess?: boolean;
  isActive?: boolean;
}

/**
 * Computes the custom auth claims for a staff doc. Single source of truth
 * shared by the `syncMyClaims` callable (sign-in path) and the
 * `onStaffWritten` trigger (admin-edit path).
 *
 * Archiving is an access-revocation event: a missing staff doc or
 * `isActive === false` collapses every claim to
 * `{ role: null, hasSpecialAccess: false, isAdmin: false }`. A doc
 * *without* an `isActive` field is treated as active so legacy docs that
 * predate the field don't lock out active users.
 */
export function computeClaims(staffData: StaffClaimSource | null | undefined): StaffClaims {
  if (!staffData || staffData.isActive === false) {
    return { role: null, hasSpecialAccess: false, isAdmin: false };
  }
  const role = staffData.role ?? null;
  const isAdmin = isAdminRole(role) || (staffData.hasAdminAccess ?? false);
  const hasSpecialAccess = isSpecialRole(role) || isAdmin;
  return { role, hasSpecialAccess, isAdmin };
}

/**
 * True when a staff-doc change drops elevated access (special or admin —
 * e.g. an archived Peer Evaluator). `onStaffWritten` uses this to also
 * revoke the user's refresh tokens so the stale elevated ID token dies at
 * its next refresh (≤1h) instead of lingering until the user signs out.
 */
export function elevatedAccessRevoked(before: StaffClaims, after: StaffClaims): boolean {
  return (before.hasSpecialAccess || before.isAdmin) && !(after.hasSpecialAccess || after.isAdmin);
}
