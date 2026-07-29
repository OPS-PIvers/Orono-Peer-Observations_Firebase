import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, isAdminRole, isSpecialRole } from '@ops/shared';

/**
 * Just the two /staff fields this module cares about, typed to reflect that a
 * raw Admin SDK read bypasses the Zod schema's defaults — unlike a client
 * read through `staff.parse(...)`, `hasAdminAccess` here may genuinely be
 * `undefined` on a legacy doc, not just `false`.
 */
interface StaffAccessFields {
  role?: string;
  hasAdminAccess?: boolean;
}

/**
 * The two caller-authorization tiers used by admin-area callables:
 *  - `'admin'`   — admin-only actions (e.g. resendStaffInvite).
 *  - `'special'` — PE-or-admin actions (e.g. sendManualEmail,
 *    sendBulkManualEmail). Every `'admin'` caller also satisfies `'special'`.
 */
export type CallerAccessLevel = 'admin' | 'special';

/**
 * Whether `role`/`hasAdminAccess` satisfy `level`, mirroring the claim
 * computation in syncMyClaims.ts exactly:
 *   isAdmin          = isAdminRole(role) || hasAdminAccess
 *   hasSpecialAccess = isSpecialRole(role) || isAdmin
 */
function meetsAccessLevel(
  level: CallerAccessLevel,
  role: string | null | undefined,
  hasAdminAccess: boolean,
): boolean {
  const isAdmin = isAdminRole(role) || hasAdminAccess;
  return level === 'admin' ? isAdmin : isSpecialRole(role) || isAdmin;
}

/**
 * Resolves whether a caller currently satisfies an access `level`
 * ('admin' or 'special'/PE-or-admin), re-reading the live `/staff` doc as a
 * fallback rather than trusting only the token's `role` claim.
 *
 * Why the live-doc fallback: `hasAdminAccess` is a grant on the `/staff` doc
 * that's independent of professional role (packages/shared/src/schema/
 * staff.ts), and syncMyClaims.ts folds it into the `isAdmin` custom claim as
 * `isAdminRole(role) || hasAdminAccess`. But a caller's ID token isn't
 * refreshed the instant an admin toggles that flag — only on next sign-in or
 * an explicit "Refresh access" click — so trusting the token's `role` claim
 * alone would latent-fail a freshly-granted hasAdminAccess caller, and
 * (worse) latent-*succeed* for a caller whose hasAdminAccess was just
 * revoked. Re-reading the live doc when the token alone doesn't already
 * satisfy `level` closes both gaps, matching the pattern already used by
 * reopenObservation.ts, uploadEvidenceFile.ts, migrateRolesToSlugs.ts, etc.
 *
 * Extracted so resendStaffInvite.ts, sendManualEmail.ts, and
 * sendBulkManualEmail.ts — three callables that live on the same Staff admin
 * page — can't drift out of sync with each other on what "admin" or
 * "PE-or-admin" means, the way resendStaffInvite and sendBulkManualEmail once
 * did (see INTEG-AUTHZ).
 */
export async function callerMeetsAccessLevel(
  db: Firestore,
  args: { email: string; tokenRole: string | null | undefined; level: CallerAccessLevel },
): Promise<boolean> {
  const { email, tokenRole, level } = args;

  if (meetsAccessLevel(level, tokenRole, false)) return true;

  const snap = await db.doc(`${COLLECTIONS.staff}/${email}`).get();
  const staff = snap.exists ? (snap.data() as StaffAccessFields | undefined) : undefined;
  if (!staff) return false;

  // hasAdminAccess's schema default is `false`; fall back explicitly rather
  // than letting a legacy doc without the field parse as `undefined`.
  const liveHasAdminAccess = staff.hasAdminAccess ?? false;
  return meetsAccessLevel(level, staff.role, liveHasAdminAccess);
}
