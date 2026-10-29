import type { Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  canOpenAdminConsole,
  hasObservationOversight,
  isAdminRole,
  isSpecialRole,
} from '@ops/shared';

/**
 * Just the two /staff fields this module cares about, typed to reflect that a
 * raw Admin SDK read bypasses the Zod schema's defaults — unlike a client
 * read through `staff.parse(...)`, `hasAdminAccess` here may genuinely be
 * `undefined` on a legacy doc, not just `false`.
 */
interface StaffAccessFields {
  role?: string;
  hasAdminAccess?: boolean;
  isActive?: boolean;
}

/**
 * The caller-authorization tiers used by admin-area callables:
 *  - `'oversight'` — district oversight of every observation and window
 *    (reopen, cancel others' windows/bookings): Full Access only
 *    (hasObservationOversight). Separate from the console on purpose:
 *    hasAdminAccess opens the Admin Console, not other people's
 *    observations. It does not imply the tiers below.
 *  - `'console'` — Admin Console actions (e.g. resendStaffInvite, rollover,
 *    migrations): Full Access or hasAdminAccess (canOpenAdminConsole). A
 *    building Administrator is `'admin'` but not `'console'`.
 *  - `'admin'`   — the isAdmin claim (Administrator / Full Access /
 *    hasAdminAccess).
 *  - `'special'` — PE-or-admin actions (e.g. sendManualEmail,
 *    sendBulkManualEmail). Each of 'console', 'admin', 'special' satisfies the ones below it.
 */
export type CallerAccessLevel = 'oversight' | 'console' | 'admin' | 'special';

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
  if (level === 'oversight') return hasObservationOversight(role);
  if (level === 'console') return canOpenAdminConsole(role, hasAdminAccess);
  const isAdmin = isAdminRole(role) || hasAdminAccess;
  return level === 'admin' ? isAdmin : isSpecialRole(role) || isAdmin;
}

/**
 * Resolves whether a caller currently satisfies an access `level`
 * ('admin' or 'special'/PE-or-admin), reading the live `/staff` doc rather
 * than trusting only the token's `role` claim.
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
 *
 * IMPORTANT — what's immediate and what isn't:
 *   - An `isActive: false` change on the live `/staff` doc takes effect on
 *     this caller's very next call: the doc is always read, and an archived
 *     caller is refused even when the token's role claim alone would pass.
 *     Archiving leaves `role` on the doc and the claim in the token until
 *     it refreshes, so the token must never be enough on its own.
 *   - A `hasAdminAccess: false` change is also immediate, because the token
 *     role alone never grants it.
 *   - A *role demotion* (e.g. peer-evaluator -> teacher) is NOT caught this
 *     quickly: if the stale token still carries the old role claim, that
 *     claim satisfies `level`, so the demotion has no effect until the
 *     caller's ID token refreshes (next sign-in or an explicit "Refresh
 *     access"). Don't assume both cases are immediate.
 */
export async function callerMeetsAccessLevel(
  db: Firestore,
  args: { email: string; tokenRole: string | null | undefined; level: CallerAccessLevel },
): Promise<boolean> {
  const { email, tokenRole, level } = args;

  const snap = await db.doc(`${COLLECTIONS.staff}/${email}`).get();
  const staff = snap.exists ? (snap.data() as StaffAccessFields | undefined) : undefined;

  // An archived caller gets nothing, from the token or the live doc —
  // offboarding sets isActive: false but leaves role and hasAdminAccess,
  // and the caller's session may not be revoked yet. isActive's schema
  // default is `true` (packages/shared/src/schema/staff.ts), so a legacy doc
  // missing the field is still treated as active, matching that default.
  if (staff?.isActive === false) return false;

  if (meetsAccessLevel(level, tokenRole, false)) return true;
  if (!staff) return false;

  // hasAdminAccess's schema default is `false`; fall back explicitly rather
  // than letting a legacy doc without the field parse as `undefined`.
  const liveHasAdminAccess = staff.hasAdminAccess ?? false;
  return meetsAccessLevel(level, staff.role, liveHasAdminAccess);
}
