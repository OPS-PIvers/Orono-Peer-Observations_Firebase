import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type EmailTemplate } from '@ops/shared';
import { callerMeetsAccessLevel } from '../lib/callerAccess.js';
import { sendEmail, substituteVariables } from '../lib/emailUtils.js';
import { RATE_LIMIT_KEYS, checkRateLimit, loadRateLimits } from '../lib/rateLimit.js';
import {
  allowedClientVars,
  buildManualEmailVars,
  loadRoleLabels,
  loadServerAppVars,
  loadStaffPerson,
} from './manualEmailVars.js';

if (getApps().length === 0) initializeApp();

/** One hour, in milliseconds — the manualEmailsPerHour window. */
const HOUR_MS = 60 * 60 * 1000;

interface SendManualEmailRequest {
  templateId?: string;
  toEmail?: string;
  /** Honored only for console admins (test sends); see allowedClientVars. */
  vars?: Record<string, string>;
}

/**
 * Callable function for PEs to send manual-trigger templates to a
 * specific staff member from the StaffPersonPage, and for console admins to
 * send a test of any manual template from the Email Templates page.
 *
 * Safeguards: below the console tier `toEmail` must be an active staff
 * member; every caller is held to rateLimits.manualEmailsPerHour; and the
 * template variables are built on the server (manualEmailVars.ts), so a
 * caller can't swap the signup link, app name or names in the email.
 *
 * Auth check: "PE or admin" is resolved via the shared `callerMeetsAccessLevel`
 * helper (../lib/callerAccess.ts, level: 'special'), which also backs
 * sendBulkManualEmail.ts and resendStaffInvite.ts. That helper re-reads the
 * live /staff doc when the token's role claim alone doesn't already qualify,
 * so a staff member granted (or revoked) `hasAdminAccess: true` is authorized
 * (or rejected) immediately rather than waiting for their ID token to
 * refresh. See INTEG-AUTHZ.
 */
export const sendManualEmail = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const db = getFirestore();

    const callerRole = request.auth.token['role'] as string | undefined;
    const hasSpecialAccess = await callerMeetsAccessLevel(db, {
      email: callerEmail,
      tokenRole: callerRole,
      level: 'special',
    });
    if (!hasSpecialAccess) {
      throw new HttpsError('permission-denied', 'Only PEs and admins can send manual emails');
    }

    const {
      templateId,
      toEmail: rawToEmail,
      vars,
    } = (request.data ?? {}) as SendManualEmailRequest;
    if (!templateId || typeof rawToEmail !== 'string' || !rawToEmail) {
      throw new HttpsError('invalid-argument', 'templateId and toEmail are required');
    }
    const toEmail = rawToEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      throw new HttpsError('invalid-argument', 'toEmail is not a valid email address');
    }

    const templateSnap = await db.collection(COLLECTIONS.emailTemplates).doc(templateId).get();
    if (!templateSnap.exists) throw new HttpsError('not-found', 'Template not found');

    const template = templateSnap.data() as EmailTemplate;
    if (!template.isActive) throw new HttpsError('failed-precondition', 'Template is inactive');
    if (template.triggerType !== 'manual') {
      throw new HttpsError('invalid-argument', 'Only manual templates can be sent this way');
    }

    // Recipient allow-list. Below the console tier a manual send can only
    // reach an active staff member — the StaffPersonPage use case. Only a
    // console admin (the Email Templates page's "Send Test…") may send to an
    // address outside the roster.
    const isConsoleCaller = await callerMeetsAccessLevel(db, {
      email: callerEmail,
      tokenRole: callerRole,
      level: 'console',
    });
    const recipient = await loadStaffPerson(db, toEmail);
    if (!isConsoleCaller && !recipient?.isActive) {
      throw new HttpsError(
        'permission-denied',
        'Manual emails can only be sent to active staff members.',
      );
    }

    // Charged only once the request is otherwise valid, as in
    // sendBulkManualEmail, so a rejected call doesn't burn a slot.
    const limits = await loadRateLimits(db);
    const decision = await checkRateLimit(db, {
      userEmail: callerEmail,
      key: RATE_LIMIT_KEYS.manualEmail,
      max: limits.manualEmailsPerHour,
      windowMs: HOUR_MS,
    });
    if (!decision.allowed) {
      throw new HttpsError(
        'resource-exhausted',
        `Manual email limit reached (${String(limits.manualEmailsPerHour)}/hour). Try again later.`,
      );
    }

    const [app, caller] = await Promise.all([
      loadServerAppVars(db),
      loadStaffPerson(db, callerEmail),
    ]);
    const roleLabels = await loadRoleLabels(db, [recipient?.role]);
    const fullVars = buildManualEmailVars({
      app,
      caller: caller ?? { email: callerEmail },
      recipient,
      roleLabels,
      clientVars: allowedClientVars(vars, isConsoleCaller),
    });

    const mailDocId = `manual-${templateId}-${toEmail.split('@')[0]}-${String(Date.now())}`;
    const result = await sendEmail({
      db,
      to: toEmail,
      subject: substituteVariables(template.subject, fullVars),
      html: substituteVariables(template.bodyHtml, fullVars),
      mailDocId,
      triggerType: 'manual',
      auditDetails: {
        templateId,
        toEmail,
        callerEmail,
        triggerType: 'manual',
      },
    });

    // Recipient preferences can suppress a manual message entirely — surface
    // that to the sender instead of silently reporting success.
    if (!result.queued) {
      throw new HttpsError(
        'failed-precondition',
        'This staff member has opted out of direct messages (Profile → email preferences), so the email was not sent.',
      );
    }

    return { sent: true, mailDocId };
  },
);
