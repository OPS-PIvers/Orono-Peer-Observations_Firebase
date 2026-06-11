import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type Role } from '@ops/shared';
import { sendTemplatedEmail, staffInviteMailDocId } from '../lib/emailUtils.js';
import { computeClaims, elevatedAccessRevoked, type StaffClaimSource } from './computeClaims.js';
import { roleGrantsSpecialAccess } from './syncMyClaims.js';

if (getApps().length === 0) initializeApp();

/**
 * Re-syncs an auth user's custom claims when their /staff/{email} doc
 * changes. Covers:
 *   - admin promotes someone (Teacher → Peer Evaluator) — claims updated
 *     so the next token refresh picks up new permissions
 *   - admin archives/deactivates a staff member (isActive → false) — claims
 *     collapse to { role: null, hasSpecialAccess: false, isAdmin: false }
 *     (they can still sign in, but rules block sensitive ops)
 *   - staff doc deleted entirely — claims cleared
 *
 * If the matching auth user doesn't exist yet (admin pre-provisioned a
 * staff member who hasn't signed in yet), this trigger no-ops; the claims
 * will be set on first sign-in via syncMyClaims.
 *
 * Special access also derives from the staff member's `/roles/{roleId}`
 * doc (`isSpecialAccess`) — see roleGrantsSpecialAccess. Edits to a role
 * doc itself don't fire this trigger; they take effect at each user's
 * next sign-in (syncMyClaims) or next staff-doc write.
 *
 * Note: existing tokens still carry old claims until they refresh. When a
 * change removes elevated access (special/admin → none), refresh tokens
 * are revoked so the stale token cannot outlive its ≤1h expiry. The web
 * client's AuthProvider exposes `refreshClaims()` for promote-then-test
 * cases.
 */
export const onStaffWritten = onDocumentWritten(
  { document: 'staff/{email}', region: 'us-central1', memory: '256MiB' },
  async (event) => {
    const email = event.params.email;
    const before = event.data?.before.data() as StaffClaimSource | undefined;
    const after = event.data?.after.data() as
      | (StaffClaimSource & {
          name?: string;
          year?: number;
        })
      | undefined;
    const base = computeClaims(after);

    let user;
    try {
      user = await getAuth().getUserByEmail(email);
    } catch (err) {
      // user-not-found is the common case (staff doc created before the
      // person ever signed in). Log and bail.
      const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : null;
      if (code === 'auth/user-not-found') {
        logger.info('onStaffWritten: no auth user yet for', { email });
        return;
      }
      throw err;
    }

    const db = getFirestore();
    // Admin-defined roles can grant special access via the /roles doc's
    // isSpecialAccess flag; isAdmin stays restricted to the built-in admin
    // roles and staff.hasAdminAccess.
    const specialViaRoleDoc = await roleGrantsSpecialAccess(db, base.role);
    const claims = { ...base, hasSpecialAccess: base.hasSpecialAccess || specialViaRoleDoc };
    const { role, hasSpecialAccess, isAdmin } = claims;

    await getAuth().setCustomUserClaims(user.uid, { role, hasSpecialAccess, isAdmin });
    logger.info('onStaffWritten: claims synced', { email, role, hasSpecialAccess, isAdmin });

    // Access revocation (archive/demote/delete of a special-access or admin
    // user): kill refresh tokens so the old elevated ID token dies at its
    // next refresh instead of lingering until the user signs out. The
    // before-claims must also consult the role doc, or archiving a
    // custom-special-access user would skip revocation.
    const beforeBase = computeClaims(before);
    const beforeClaims = {
      ...beforeBase,
      hasSpecialAccess:
        beforeBase.hasSpecialAccess ||
        (beforeBase.role === base.role
          ? specialViaRoleDoc
          : await roleGrantsSpecialAccess(db, beforeBase.role)),
    };
    if (elevatedAccessRevoked(beforeClaims, claims)) {
      await getAuth().revokeRefreshTokens(user.uid);
      logger.info('onStaffWritten: refresh tokens revoked (elevated access removed)', { email });
    }

    // New staff invite email — only on creation (before=null) for active staff
    const isNewStaff = !event.data?.before.exists && event.data?.after.exists;
    if (isNewStaff && after?.isActive) {
      try {
        // Resolve role slug → displayName for the invite email so the
        // recipient sees a human-readable role.
        let roleLabel = after.role ?? '';
        if (after.role) {
          const roleDoc = await db.doc(`${COLLECTIONS.roles}/${after.role}`).get();
          if (roleDoc.exists) {
            roleLabel = (roleDoc.data() as Role).displayName;
          }
        }
        await sendTemplatedEmail({
          db,
          triggerType: 'staff.created',
          to: email,
          vars: {
            staffName: after.name ?? email.split('@')[0],
            staffEmail: email,
            staffRole: roleLabel,
            staffYear: String(after.year ?? 1),
            observedName: after.name ?? email.split('@')[0],
            observedEmail: email,
          },
          mailDocId: staffInviteMailDocId(email, Date.now()),
          auditDetails: { email, triggerType: 'staff.created' },
        });
      } catch (emailErr) {
        logger.error('onStaffWritten: invite email failed (non-fatal)', emailErr);
      }
    }
  },
);
