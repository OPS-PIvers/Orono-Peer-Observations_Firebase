import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, OBSERVATION_TYPES } from '@ops/shared';
import {
  formatDate,
  loadActiveTemplate,
  sendEmail,
  substituteVariables,
} from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

/**
 * Daily scheduled job that sends two types of reminder emails:
 *   1. Pre-observation reminders N days before a Draft observation's date.
 *   2. Incomplete WP/IR reminders N days after creation with no responses.
 *
 * Runs at 07:00 America/Chicago. The N values come from each template's
 * scheduledDays field so admins can tune them without a deploy.
 */
export const scheduledEmailReminders = onSchedule(
  {
    schedule: 'every day 07:00',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const db = getFirestore();
    const today = new Date();

    // ── 1. Pre-observation reminders ──────────────────────────────────
    const preObsTemplate = await loadActiveTemplate(db, 'scheduled.preObservation');
    if (preObsTemplate) {
      const daysAhead = preObsTemplate.scheduledDays ?? 3;
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysAhead);
      const targetStart = new Date(targetDate);
      targetStart.setHours(0, 0, 0, 0);
      const targetEnd = new Date(targetDate);
      targetEnd.setHours(23, 59, 59, 999);

      const snap = await db
        .collection(COLLECTIONS.observations)
        .where('status', '==', OBSERVATION_STATUS.draft)
        .where('observationDate', '>=', Timestamp.fromDate(targetStart))
        .where('observationDate', '<=', Timestamp.fromDate(targetEnd))
        .get();

      for (const docSnap of snap.docs) {
        const obs = docSnap.data();
        const vars = {
          observerName: (obs['observerEmail'] as string | undefined)?.split('@')[0] ?? '',
          observerEmail: (obs['observerEmail'] as string | undefined) ?? '',
          observedName: (obs['observedName'] as string | undefined) ?? '',
          observedEmail: (obs['observedEmail'] as string | undefined) ?? '',
          observedRole: (obs['observedRole'] as string | undefined) ?? '',
          observedYear: String(obs['observedYear'] ?? ''),
          observationDate: formatDate(obs['observationDate']),
          observationName: (obs['observationName'] as string | undefined) ?? '',
          observationType: (obs['type'] as string | undefined) ?? '',
        };

        let recipient: string | string[];
        if (preObsTemplate.recipient === 'observer') {
          recipient = (obs['observerEmail'] as string | undefined) ?? '';
        } else if (preObsTemplate.recipient === 'both') {
          recipient = [obs['observedEmail'] as string, obs['observerEmail'] as string].filter(
            Boolean,
          ) as string[];
        } else {
          recipient = (obs['observedEmail'] as string | undefined) ?? '';
        }

        const recipientArr = Array.isArray(recipient) ? recipient : [recipient];
        if (recipientArr.every((r) => !r)) continue;

        await sendEmail({
          db,
          to: recipient,
          subject: substituteVariables(preObsTemplate.subject, vars),
          html: substituteVariables(preObsTemplate.bodyHtml, vars),
          mailDocId: `preobs-${docSnap.id}-${String(daysAhead)}d`,
          auditDetails: { observationId: docSnap.id, triggerType: 'scheduled.preObservation' },
        }).catch((err) => logger.error('scheduledEmailReminders: preObs send failed', err));
      }
      logger.info('scheduledEmailReminders: preObs processed', { count: snap.size, daysAhead });
    }

    // ── 2. Incomplete WP / IR reminders ──────────────────────────────
    const incompleteTemplate = await loadActiveTemplate(db, 'scheduled.reminderIncomplete');
    if (incompleteTemplate) {
      const daysAfter = incompleteTemplate.scheduledDays ?? 7;
      const cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - daysAfter);

      const wpIrSnap = await db
        .collection(COLLECTIONS.observations)
        .where('status', '==', OBSERVATION_STATUS.draft)
        .where('type', 'in', [OBSERVATION_TYPES.workProduct, OBSERVATION_TYPES.instructionalRound])
        .where('createdAt', '<=', Timestamp.fromDate(cutoff))
        .get();

      for (const docSnap of wpIrSnap.docs) {
        const obs = docSnap.data();
        const answers: unknown[] = (obs['workProductAnswers'] as unknown[]) ?? [];
        const hasAnyAnswer = answers.some(
          (a) =>
            typeof a === 'object' &&
            a !== null &&
            (a as Record<string, string>)['answer']?.trim(),
        );
        if (hasAnyAnswer) continue;

        if (!obs['observedEmail']) continue;

        const vars = {
          observedName: (obs['observedName'] as string | undefined) ?? '',
          observedEmail: (obs['observedEmail'] as string | undefined) ?? '',
          observedRole: (obs['observedRole'] as string | undefined) ?? '',
          observationType: (obs['type'] as string | undefined) ?? '',
          observationName: (obs['observationName'] as string | undefined) ?? '',
        };

        await sendEmail({
          db,
          to: obs['observedEmail'] as string,
          subject: substituteVariables(incompleteTemplate.subject, vars),
          html: substituteVariables(incompleteTemplate.bodyHtml, vars),
          mailDocId: `incomplete-${docSnap.id}`,
          auditDetails: { observationId: docSnap.id, triggerType: 'scheduled.reminderIncomplete' },
        }).catch((err) => logger.error('scheduledEmailReminders: incomplete send failed', err));
      }
      logger.info('scheduledEmailReminders: incomplete processed', { count: wpIrSnap.size });
    }
  },
);
