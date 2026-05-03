import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { isAdminRole, isSpecialRole } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Re-syncs an auth user's custom claims when their /staff/{email} doc
 * changes. Covers:
 *   - admin promotes someone (Teacher → Peer Evaluator) — claims updated
 *     so the next token refresh picks up new permissions
 *   - admin deactivates a staff member — role goes to null, hasSpecialAccess
 *     to false (they can still sign in, but rules block sensitive ops)
 *   - staff doc deleted entirely — claims cleared
 *
 * If the matching auth user doesn't exist yet (admin pre-provisioned a
 * staff member who hasn't signed in yet), this trigger no-ops; the claims
 * will be set on first sign-in via syncMyClaims.
 *
 * Note: existing tokens still carry old claims until they refresh. The
 * web client's AuthProvider exposes `refreshClaims()` for promote-then-
 * test cases.
 */
export const onStaffWritten = onDocumentWritten(
  { document: 'staff/{email}', region: 'us-central1', memory: '256MiB' },
  async (event) => {
    const email = event.params.email;
    const after = event.data?.after.data() as
      | { role?: string; hasAdminAccess?: boolean }
      | undefined;
    const role = after?.role ?? null;
    const hasAdminAccess = after?.hasAdminAccess ?? false;
    const isAdmin = isAdminRole(role) || hasAdminAccess;
    const hasSpecialAccess = isSpecialRole(role) || isAdmin;

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

    await getAuth().setCustomUserClaims(user.uid, { role, hasSpecialAccess, isAdmin });
    logger.info('onStaffWritten: claims synced', { email, role, hasSpecialAccess, isAdmin });
  },
);
