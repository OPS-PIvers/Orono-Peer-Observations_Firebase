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
 * Return the UTC Date corresponding to midnight Chicago time on the calendar
 * day that is `offsetDays` from the Chicago calendar date of `utcNow`.
 * Uses Intl to derive the UTC offset rather than assuming a fixed offset,
 * so it handles CST (UTC-6) and CDT (UTC-5) automatically.
 */
function chicagoMidnight(utcNow: Date, offsetDays: number): { start: Date; end: Date } {
  // 1. Find today's calendar date in Chicago (en-CA gives YYYY-MM-DD)
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
  }).format(utcNow);

  // 2. Advance by offsetDays (re-format to handle month/year rollover)
  const [y, m, d] = todayStr.split('-').map(Number);
  const anchorUTC = new Date(Date.UTC(y, m - 1, d + offsetDays, 12, 0, 0)); // noon UTC on target day
  const targetStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
  }).format(anchorUTC);
  const [ty, tm, td] = targetStr.split('-').map(Number);

  // 3. Derive the Chicago UTC offset using noon UTC as an anchor (avoids DST edge cases)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(anchorUTC);
  const chicagoHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
  const chicagoMin = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // Minutes that Chicago is behind UTC (e.g. CDT → 5*60=300, CST → 6*60=360)
  const behindUTCMins = 12 * 60 - (chicagoHour * 60 + chicagoMin);

  // 4. Chicago midnight = UTC midnight + behindUTCMins
  const start = new Date(Date.UTC(ty, tm - 1, td, 0, 0, 0) + behindUTCMins * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

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
      const { start: targetStart, end: targetEnd } = chicagoMidnight(today, daysAhead);

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
      // Use Chicago midnight as the cutoff so observations created on the same
      // calendar day N days ago are included regardless of time-of-day.
      const { start: cutoff } = chicagoMidnight(today, -daysAfter);

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
