import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, isAdminRole, isSpecialRole, type EmailTemplate } from '@ops/shared';
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
    const hasSpecialAccess =
      isSpecialRole(callerRole ?? null) || isAdminRole(callerRole ?? null);
    if (!hasSpecialAccess) {
      throw new HttpsError('permission-denied', 'Only PEs and admins can send manual emails');
    }

    const { templateId, toEmail, vars } = (request.data ?? {}) as SendManualEmailRequest;
    if (!templateId || !toEmail) {
      throw new HttpsError('invalid-argument', 'templateId and toEmail are required');
    }

    const db = getFirestore();
    const templateSnap = await db.collection(COLLECTIONS.emailTemplates).doc(templateId).get();
    if (!templateSnap.exists) throw new HttpsError('not-found', 'Template not found');

    const template = templateSnap.data() as EmailTemplate;
    if (!template.isActive) throw new HttpsError('failed-precondition', 'Template is inactive');
    if (template.triggerType !== 'manual') {
      throw new HttpsError('invalid-argument', 'Only manual templates can be sent this way');
    }

    const appSnap = await db.doc(`${COLLECTIONS.appSettings}/global`).get();
    const appName =
      (appSnap.data()?.['branding']?.['appName'] as string | undefined) ??
      'Orono Peer Observations';
    const signupLink = (appSnap.data()?.['signupLink'] as string | undefined) ?? '';

    const fullVars: Record<string, string> = {
      appName,
      signupLink,
      signInLink: 'https://observations.orono.k12.mn.us',
      ...vars,
    };

    const mailDocId = `manual-${templateId}-${toEmail.split('@')[0]}-${String(Date.now())}`;
    await sendEmail({
      db,
      to: toEmail,
      subject: substituteVariables(template.subject, fullVars),
      html: substituteVariables(template.bodyHtml, fullVars),
      mailDocId,
      auditDetails: {
        templateId,
        toEmail,
        callerEmail: request.auth.token.email,
        triggerType: 'manual',
      },
    });

    return { sent: true, mailDocId };
  },
);
