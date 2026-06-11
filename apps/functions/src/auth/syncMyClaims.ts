import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { ALLOWED_EMAIL_DOMAIN, COLLECTIONS, isSpecialRole, type Role } from '@ops/shared';
import { computeClaims, type StaffClaimSource } from './computeClaims.js';
import { APP_URL, loadSecurityAdminEmail, sendEmail } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

/**
 * True when `/roles/{role}` is an active role doc with `isSpecialAccess`
 * set. Extends special access (filter UI / view-all) to admin-defined roles
 * beyond the hardcoded SPECIAL_ROLES slugs. The built-ins are a floor —
 * `computeClaims` already grants them, so the lookup is skipped for them
 * and unticking the checkbox on a built-in role removes nothing.
 */
export async function roleGrantsSpecialAccess(
  db: Firestore,
  role: string | null,
): Promise<boolean> {
  if (!role || isSpecialRole(role)) return false;
  const roleSnap = await db.doc(`${COLLECTIONS.roles}/${role}`).get();
  if (!roleSnap.exists) return false;
  const roleData = roleSnap.data() as Pick<Role, 'isSpecialAccess' | 'isActive'>;
  return roleData.isSpecialAccess && roleData.isActive;
}

/**
 * Callable function the client invokes after sign-in to sync the caller's
 * custom auth claims (`role`, `hasSpecialAccess`, `isAdmin`) from their
 * `/staff/{email}` doc plus their role's `/roles/{roleId}` doc (whose
 * `isSpecialAccess` flag can extend special access to custom roles).
 *
 * Background: Firebase Auth blocking functions (which would normally do this
 * server-side at user-creation time) require Identity Platform / GCIP, a
 * paid tier. On the Spark plan we set claims via this callable instead.
 *
 * Domain enforcement is layered:
 *   1) `hd` parameter on the Google sign-in provider (client SignInScreen)
 *   2) AuthProvider's post-sign-in email check (signs out non-domain users)
 *   3) `isFromOronoDomain()` guard inside every Firestore rule
 *   4) This function (refuses to issue claims to non-domain accounts)
 */
export const syncMyClaims = onCall({ region: 'us-central1', memory: '256MiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const callerEmail = request.auth.token.email?.toLowerCase();
  if (!callerEmail?.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    // Best-effort security alert to the configured admin email before throwing.
    const db = getFirestore();
    const rejectedEmail = callerEmail ?? '(unknown)';
    try {
      const securityAdminEmail = await loadSecurityAdminEmail(db);
      if (securityAdminEmail) {
        const nowMs = Date.now();
        const bodyHtml = `
<p>A sign-in attempt was rejected because the account does not belong to the <strong>@${ALLOWED_EMAIL_DOMAIN}</strong> domain.</p>
<table style="border-collapse:collapse;font-size:14px;">
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Rejected account</td><td>${rejectedEmail}</td></tr>
</table>
<p>If this was unexpected, review the <a href="${APP_URL}">Audit Log</a> in the admin console.</p>
        `.trim();
        await sendEmail({
          db,
          to: securityAdminEmail,
          subject: `[Security Alert] Non-domain sign-in rejected: ${rejectedEmail}`,
          html: bodyHtml,
          mailDocId: `securityAlert-signInRejected-${rejectedEmail.replace('@', '-at-')}-${String(nowMs)}`,
          auditDetails: { alertType: 'signInRejected', rejectedEmail },
        });
        logger.info('syncMyClaims: security alert sent for rejected sign-in', {
          rejectedEmail,
          securityAdminEmail,
        });
      }
    } catch (alertErr) {
      // Non-fatal: we must still throw the permission-denied error below.
      logger.error('syncMyClaims: failed to send security alert (non-fatal)', alertErr);
    }
    throw new HttpsError(
      'permission-denied',
      `Sign-in is restricted to @${ALLOWED_EMAIL_DOMAIN} accounts.`,
    );
  }
  const email = callerEmail;

  const db = getFirestore();
  const staffSnap = await db.doc(`${COLLECTIONS.staff}/${email}`).get();
  const staffData = staffSnap.exists ? (staffSnap.data() as StaffClaimSource) : null;
  // Archived (isActive === false) or missing staff docs collapse to
  // no-access claims — see computeClaims.
  const base = computeClaims(staffData);
  // Admin-defined roles can grant special access via the /roles doc's
  // isSpecialAccess flag; isAdmin stays restricted to the built-in admin
  // roles and staff.hasAdminAccess.
  const hasSpecialAccess = base.hasSpecialAccess || (await roleGrantsSpecialAccess(db, base.role));
  const { role, isAdmin } = base;

  await getAuth().setCustomUserClaims(request.auth.uid, { role, hasSpecialAccess, isAdmin });
  logger.info('syncMyClaims: claims set', { email, role, hasSpecialAccess, isAdmin });
  return { role, hasSpecialAccess, isAdmin };
});
