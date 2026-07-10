import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { AUDIT_ACTIONS, COLLECTIONS } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Delivery-state sub-object the Trigger Email extension writes back onto a
 * `/mail/{mailId}` doc after it attempts SMTP delivery (undocumented in
 * `@ops/shared` since only this trigger reads it — the extension itself
 * owns the shape). `state` moves PENDING -> PROCESSING -> SUCCESS | ERROR.
 */
interface MailDeliveryState {
  state?: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR' | 'RETRY';
  error?: string | null;
  attempts?: number;
  startTime?: unknown;
  endTime?: unknown;
  info?: {
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
    pending?: string[];
    response?: string;
  };
}

interface MailDoc {
  to?: string | string[];
  message?: { subject?: string };
  delivery?: MailDeliveryState;
}

/**
 * Watches `/mail/{mailId}` for the delivery-state update the Trigger Email
 * extension writes after it actually attempts SMTP delivery (sendEmail()
 * only writes the doc that *queues* the send — see the NOTE in
 * emailUtils.ts). When delivery transitions into `ERROR` — a bounce, a
 * spam block, an SMTP rejection — records a distinct
 * `AUDIT_ACTIONS.emailDeliveryFailed` entry (rather than silently leaving
 * the earlier `emailSent` entry as the only trace) so admins have an
 * after-the-fact signal that a reminder/lifecycle email never actually
 * reached its recipient.
 *
 * Only fires on the PENDING/PROCESSING -> ERROR transition (guarded by
 * `before`'s state not already being ERROR) so a single failure isn't
 * logged more than once if the extension touches the doc again (e.g. a
 * lease renewal write) after it has already gone terminal.
 */
export const onMailWritten = onDocumentWritten(
  { document: 'mail/{mailId}', region: 'us-central1', memory: '256MiB' },
  async (event) => {
    const afterSnap = event.data?.after;
    if (!afterSnap?.exists) return; // deleted (e.g. pruned) — nothing to record

    const after = afterSnap.data() as MailDoc | undefined;
    const before = event.data?.before.exists
      ? (event.data.before.data() as MailDoc | undefined)
      : undefined;

    const afterState = after?.delivery?.state;
    const beforeState = before?.delivery?.state;
    if (afterState !== 'ERROR' || beforeState === 'ERROR') return;

    const mailId = event.params.mailId;
    const recipients = Array.isArray(after?.to) ? after.to : after?.to ? [after.to] : [];

    try {
      const db = getFirestore();
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: FieldValue.serverTimestamp(),
        userEmail: null,
        action: AUDIT_ACTIONS.emailDeliveryFailed,
        target: `mail/${mailId}`,
        details: {
          to: recipients,
          subject: after?.message?.subject ?? null,
          mailDocId: mailId,
          error: after?.delivery?.error ?? null,
          attempts: after?.delivery?.attempts ?? null,
        },
      });
      logger.warn('onMailWritten: delivery failed', {
        mailId,
        to: recipients,
        error: after?.delivery?.error,
      });
    } catch (err) {
      logger.error('onMailWritten: failed to record delivery-failure audit entry', {
        mailId,
        err,
      });
    }
  },
);
