import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { APP_SETTINGS_DOC_ID, COLLECTIONS, type EmailTemplate } from '@ops/shared';
import { callerMeetsAccessLevel } from '../lib/callerAccess.js';
import { sendEmail, substituteVariables } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

interface SendManualEmailRequest {
  templateId?: string;
  toEmail?: string;
  vars?: Record<string, string>;
}

/**
 * Callable function for PEs to send manual-trigger templates to a
 * specific staff member from the StaffPersonPage.
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

    const { templateId, toEmail, vars } = (request.data ?? {}) as SendManualEmailRequest;
    if (!templateId || !toEmail) {
      throw new HttpsError('invalid-argument', 'templateId and toEmail are required');
    }
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

    const appSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
    const appData = appSnap.data() as
      | { branding?: { appName?: string }; signupLink?: string }
      | undefined;
    const appName = appData?.branding?.appName ?? 'Orono Peer Observations';
    const signupLink = appData?.signupLink ?? '';

    const fullVars: Record<string, string> = {
      appName,
      signupLink,
      signInLink: 'https://observations.orono.k12.mn.us',
      ...vars,
    };

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
        callerEmail: request.auth.token.email,
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
