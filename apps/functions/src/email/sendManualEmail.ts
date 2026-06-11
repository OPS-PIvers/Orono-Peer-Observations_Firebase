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
import { APP_URL, sendEmail, substituteVariables } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

interface SendManualEmailRequest {
  templateId?: string;
  toEmail?: string;
  vars?: Record<string, string>;
  /** Admin test-send from the Email Templates page (any template, sample data). */
  isTest?: boolean;
}

/** Subject prefix for test sends so the email can't be mistaken for a real notification. */
export const TEST_SUBJECT_PREFIX = '[TEST] ';

/**
 * Guard for which templates a caller may send.
 *
 * Real sends (the StaffPersonPage flow) are restricted to active
 * manual-trigger templates — automatic templates must only ever fire from
 * their lifecycle triggers. Test sends from the admin Email Templates page
 * may exercise ANY template (automatic or inactive included) so admins can
 * verify what e.g. a booking confirmation looks like in a real inbox, but
 * only admins may request them.
 */
export function assertTemplateSendable(
  template: Pick<EmailTemplate, 'isActive' | 'triggerType'>,
  opts: { isTest: boolean; isAdmin: boolean },
): void {
  if (opts.isTest) {
    if (!opts.isAdmin) {
      throw new HttpsError('permission-denied', 'Only admins can send test emails');
    }
    return;
  }
  if (!template.isActive) throw new HttpsError('failed-precondition', 'Template is inactive');
  if (template.triggerType !== 'manual') {
    throw new HttpsError('invalid-argument', 'Only manual templates can be sent this way');
  }
}

/** Substitute vars into the subject line, prefixing test sends with [TEST]. */
export function buildSendSubject(
  subjectTemplate: string,
  vars: Record<string, string>,
  isTest: boolean,
): string {
  const subject = substituteVariables(subjectTemplate, vars);
  return isTest ? `${TEST_SUBJECT_PREFIX}${subject}` : subject;
}

/**
 * Callable function for PEs to send manual-trigger templates to a
 * specific staff member from the StaffPersonPage, and for admins to
 * test-send any template with sample data from the Email Templates page.
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

    const { templateId, toEmail, vars, isTest } = (request.data ?? {}) as SendManualEmailRequest;
    if (!templateId || !toEmail) {
      throw new HttpsError('invalid-argument', 'templateId and toEmail are required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      throw new HttpsError('invalid-argument', 'toEmail is not a valid email address');
    }
    const isTestSend = isTest === true;

    const db = getFirestore();
    const templateSnap = await db.collection(COLLECTIONS.emailTemplates).doc(templateId).get();
    if (!templateSnap.exists) throw new HttpsError('not-found', 'Template not found');

    const template = templateSnap.data() as EmailTemplate;
    assertTemplateSendable(template, {
      isTest: isTestSend,
      isAdmin: isAdminRole(callerRole ?? null),
    });

    const appSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
    const appData = appSnap.data() as
      | { branding?: { appName?: string }; signupLink?: string }
      | undefined;
    const appName = appData?.branding?.appName ?? 'Orono Peer Observations';
    const signupLink = appData?.signupLink ?? '';

    const fullVars: Record<string, string> = {
      appName,
      signupLink,
      signInLink: APP_URL,
      ...vars,
    };

    const docPrefix = isTestSend ? 'test' : 'manual';
    const mailDocId = `${docPrefix}-${templateId}-${toEmail.split('@')[0]}-${String(Date.now())}`;
    await sendEmail({
      db,
      to: toEmail,
      subject: buildSendSubject(template.subject, fullVars, isTestSend),
      html: substituteVariables(template.bodyHtml, fullVars),
      mailDocId,
      auditDetails: {
        templateId,
        toEmail,
        callerEmail: request.auth.token.email,
        // Real sends only ever pass the manual guard, so this stays 'manual'
        // for them; test sends record the template's actual trigger type.
        triggerType: template.triggerType,
        ...(isTestSend ? { isTest: true } : {}),
      },
    });

    return { sent: true, mailDocId };
  },
);
