import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  isAdminRole,
  isSpecialRole,
  type EmailTemplate,
} from '@ops/shared';
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
 */
export const sendManualEmail = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerRole = request.auth.token['role'] as string | undefined;
    const hasSpecialAccess = isSpecialRole(callerRole ?? null) || isAdminRole(callerRole ?? null);
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

    const db = getFirestore();
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
