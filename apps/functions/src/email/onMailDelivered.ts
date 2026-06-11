import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { APP_SETTINGS_DOC_ID, AUDIT_ACTIONS, COLLECTIONS } from '@ops/shared';
import { sendEmail } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

/**
 * Shape of the delivery sub-object that the Trigger Email Firebase Extension
 * writes back onto each /mail document.
 *
 * Reference: https://extensions.dev/extensions/firebase/firestore-send-email
 */
export interface MailDelivery {
  state: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR' | 'RETRY';
  attempts?: number;
  error?: string;
  info?: {
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
  };
  endTime?: unknown;
  startTime?: unknown;
  leaseExpireTime?: unknown;
}

interface MailDocLike {
  to?: string | string[];
  message?: { subject?: string };
  delivery?: MailDelivery;
}

/**
 * Return true when the /mail doc has just transitioned *into* ERROR state —
 * i.e. `after.delivery.state` is "ERROR" and either there was no before-doc
 * or `before.delivery.state` was something other than "ERROR".
 *
 * Exported as a pure helper so the unit tests can verify it without touching
 * Firestore or Cloud Functions infrastructure.
 */
export function isNewDeliveryError(before: MailDocLike | null, after: MailDocLike | null): boolean {
  if (!after) return false;
  if (after.delivery?.state !== 'ERROR') return false;
  // Only fire on the *transition* — ignore docs that were already in ERROR.
  if (before?.delivery?.state === 'ERROR') return false;
  return true;
}

/**
 * Firestore trigger on mail/{mailId}.
 *
 * When the Trigger Email extension marks a /mail doc's delivery.state as
 * ERROR (i.e., the SMTP send permanently failed), this function:
 *
 *   1. Writes an `email_failed` audit log entry so admins can see it in the
 *      Audit Log admin page.
 *   2. Sends an alert to `appSettings/global.securityAdminEmail` (if set).
 *
 * The extension writes `delivery.state = ERROR` only after all retries are
 * exhausted, so this represents a genuine delivery failure — not a transient
 * PROCESSING state.
 */
export const onMailDelivered = onDocumentWritten(
  {
    document: 'mail/{mailId}',
    region: 'us-central1',
    memory: '256MiB',
  },
  async (event) => {
    const mailId = event.params.mailId;

    const beforeData = event.data?.before.exists ? (event.data.before.data() as MailDocLike) : null;
    const afterData = event.data?.after.exists ? (event.data.after.data() as MailDocLike) : null;

    if (!isNewDeliveryError(beforeData, afterData)) {
      return;
    }

    // isNewDeliveryError verified afterData !== null and delivery.state === 'ERROR'.
    // TypeScript can't see through the helper, so we re-check delivery presence here.
    const delivery = afterData?.delivery;
    if (!afterData || !delivery) {
      return;
    }

    const mail = afterData;
    const recipients = Array.isArray(mail.to) ? mail.to : mail.to ? [mail.to] : [];
    const subject = mail.message?.subject ?? '(no subject)';
    const errorMessage = delivery.error ?? 'Unknown delivery error';
    const attempts = delivery.attempts ?? 1;

    logger.error('onMailDelivered: delivery error detected', {
      mailId,
      recipients,
      subject,
      error: errorMessage,
      attempts,
    });

    const db = getFirestore();

    // 1. Write an audit log entry that admins can see.
    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail: null,
      action: AUDIT_ACTIONS.emailFailed,
      target: `mail/${mailId}`,
      details: {
        to: recipients,
        subject,
        mailId,
        error: errorMessage,
        attempts,
      },
    });

    logger.info('onMailDelivered: wrote emailFailed audit entry', { mailId });

    // 2. Alert the security admin (best-effort — failure here must not throw).
    try {
      const settingsSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
      const securityAdminEmail = settingsSnap.data()?.['securityAdminEmail'] as string | undefined;

      if (securityAdminEmail && securityAdminEmail.trim() !== '') {
        const alertMailDocId = `emailFailed-alert-${mailId}`;
        const recipientList = recipients.join(', ') || '(unknown)';
        const bodyHtml = `
<p>An email failed to deliver after all retry attempts.</p>
<table style="border-collapse:collapse;font-size:14px;">
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Mail doc ID</td><td>${mailId}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">To</td><td>${recipientList}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Subject</td><td>${subject}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Error</td><td>${errorMessage}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Attempts</td><td>${String(attempts)}</td></tr>
</table>
<p>Review the <a href="https://observations.orono.k12.mn.us">Audit Log</a> in the admin console for details.</p>
        `.trim();

        await sendEmail({
          db,
          to: securityAdminEmail.trim(),
          subject: `[Email Delivery Failure] ${subject}`,
          html: bodyHtml,
          mailDocId: alertMailDocId,
          auditDetails: { originalMailId: mailId, alertType: 'emailDeliveryFailure' },
        });

        logger.info('onMailDelivered: alert sent to security admin', {
          mailId,
          securityAdminEmail,
        });
      }
    } catch (alertErr) {
      // Non-fatal: the audit log entry was already written; this is a
      // best-effort notification only.
      logger.error('onMailDelivered: failed to send admin alert (non-fatal)', alertErr);
    }
  },
);
