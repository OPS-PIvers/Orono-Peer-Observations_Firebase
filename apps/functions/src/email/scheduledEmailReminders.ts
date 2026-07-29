import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  workProductAnswerHasText,
  type Role,
} from '@ops/shared';
import {
  formatDate,
  loadActiveTemplate,
  sendEmail,
  substituteVariables,
} from '../lib/emailUtils.js';

/** Build a slug → displayName map from the /roles collection so reminder
 *  emails can render a human-readable role even though observations now
 *  store the slug. Falls back to the input value for unmapped legacy
 *  records. */
function resolveRoleLabel(rolesByIdOrName: Map<string, string>, value: string): string {
  if (!value) return '';
  return rolesByIdOrName.get(value) ?? value;
}

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
  const [y, m, d] = todayStr.split('-').map(Number) as [number, number, number];
  const anchorUTC = new Date(Date.UTC(y, m - 1, d + offsetDays, 12, 0, 0)); // noon UTC on target day
  const targetStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
  }).format(anchorUTC);
  const [ty, tm, td] = targetStr.split('-').map(Number) as [number, number, number];

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
 * ISO 8601 year-week label (e.g. `2026-W31`) for the Chicago calendar date of
 * `utcNow`. Used to key the overdue-finalize reminder's `/mail` doc id so the
 * weekly nudge is idempotent per calendar week rather than per-day or
 * one-and-done: re-running the job on the same ISO week for the same
 * observation is a no-op (the doc id already exists), while the next week
 * produces a new id and a fresh reminder.
 */
export function isoYearWeek(utcNow: Date): string {
  // Anchor on the Chicago calendar date (not raw UTC) so the week boundary
  // matches the calendar day the reminder logic otherwise reasons about.
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
  }).format(utcNow);
  const [y, m, d] = todayStr.split('-').map(Number) as [number, number, number];

  // Standard ISO week algorithm: shift to the Thursday of this date's week
  // (ISO weeks belong to the year containing their Thursday), then count
  // whole weeks from that ISO year's own week-1 Thursday.
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const weekNum = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${String(isoYear)}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Daily scheduled job that sends three types of reminder emails:
 *   1. Pre-observation reminders N days before a Draft observation's date.
 *   2. Incomplete WP/IR reminders N days after creation with no responses.
 *   3. Overdue-finalize reminders N+ days after a Draft observation's date
 *      has passed, repeating weekly to the *observer* until finalized.
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

    // Resolve role slugs to displayName for email rendering. Includes both
    // (slug → label) and (legacy displayName → label) entries so this
    // function works whether the observation has been migrated yet.
    const rolesSnap = await db.collection(COLLECTIONS.roles).get();
    const rolesLookup = new Map<string, string>();
    for (const d of rolesSnap.docs) {
      const r = d.data() as Role;
      rolesLookup.set(r.roleId, r.displayName);
      rolesLookup.set(r.displayName, r.displayName);
    }

    // ── 1. Pre-observation reminders ──────────────────────────────────
    const preObsTemplate = await loadActiveTemplate(db, 'scheduled.preObservation');
    if (preObsTemplate) {
      const daysAhead = preObsTemplate.scheduledDays;
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
          observedRole: resolveRoleLabel(
            rolesLookup,
            (obs['observedRole'] as string | undefined) ?? '',
          ),
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
          );
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
          triggerType: 'scheduled.preObservation',
          auditDetails: { observationId: docSnap.id, triggerType: 'scheduled.preObservation' },
        }).catch((err: unknown) =>
          logger.error('scheduledEmailReminders: preObs send failed', err),
        );
      }
      logger.info('scheduledEmailReminders: preObs processed', { count: snap.size, daysAhead });
    }

    // ── 2. Incomplete WP / IR reminders ──────────────────────────────
    const incompleteTemplate = await loadActiveTemplate(db, 'scheduled.reminderIncomplete');
    if (incompleteTemplate) {
      const daysAfter = incompleteTemplate.scheduledDays;
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
        const answers: unknown[] = Array.isArray(obs['workProductAnswers'])
          ? (obs['workProductAnswers'] as unknown[])
          : [];
        const hasAnyAnswer = answers.some(
          (a) =>
            typeof a === 'object' &&
            a !== null &&
            workProductAnswerHasText((a as Record<string, unknown>)['answer']),
        );
        if (hasAnyAnswer) continue;

        if (!obs['observedEmail']) continue;

        const vars = {
          observedName: (obs['observedName'] as string | undefined) ?? '',
          observedEmail: (obs['observedEmail'] as string | undefined) ?? '',
          observedRole: resolveRoleLabel(
            rolesLookup,
            (obs['observedRole'] as string | undefined) ?? '',
          ),
          observationType: (obs['type'] as string | undefined) ?? '',
          observationName: (obs['observationName'] as string | undefined) ?? '',
        };

        await sendEmail({
          db,
          to: obs['observedEmail'] as string,
          subject: substituteVariables(incompleteTemplate.subject, vars),
          html: substituteVariables(incompleteTemplate.bodyHtml, vars),
          mailDocId: `incomplete-${docSnap.id}`,
          triggerType: 'scheduled.reminderIncomplete',
          auditDetails: { observationId: docSnap.id, triggerType: 'scheduled.reminderIncomplete' },
        }).catch((err: unknown) =>
          logger.error('scheduledEmailReminders: incomplete send failed', err),
        );
      }
      logger.info('scheduledEmailReminders: incomplete processed', { count: wpIrSnap.size });
    }

    // ── 3. Overdue-finalize reminders ─────────────────────────────────
    // Targets the *observer* (PE), not the observed staff member — the gap
    // this reminder covers is the PE's follow-through on finalizing, not the
    // observed staff's participation. Recipient is obs.observerEmail, which
    // means sendEmail's preference-suppression check (see isEmailSuppressed
    // in ../lib/emailUtils.js) looks up the observer's own /staff doc, not
    // the observed person's — exactly the gate the owner sign-off called for.
    const overdueTemplate = await loadActiveTemplate(db, 'scheduled.reminderOverdueFinalize');
    if (overdueTemplate) {
      const daysPast = overdueTemplate.scheduledDays;
      const { start: cutoff } = chicagoMidnight(today, -daysPast);
      // Weekly cadence: this label is stable for an entire ISO week, so the
      // mailDocId below is idempotent per week (re-running the same day only
      // sends once) but produces a fresh id — and a fresh send — every
      // following week the observation is still Draft.
      const week = isoYearWeek(today);

      const overdueSnap = await db
        .collection(COLLECTIONS.observations)
        .where('status', '==', OBSERVATION_STATUS.draft)
        .where('observationDate', '<=', Timestamp.fromDate(cutoff))
        .get();

      for (const docSnap of overdueSnap.docs) {
        const obs = docSnap.data();
        const observerEmail = (obs['observerEmail'] as string | undefined) ?? '';
        if (!observerEmail) continue;

        const vars = {
          observerName: observerEmail.split('@')[0] ?? '',
          observerEmail,
          observedName: (obs['observedName'] as string | undefined) ?? '',
          observedEmail: (obs['observedEmail'] as string | undefined) ?? '',
          observedRole: resolveRoleLabel(
            rolesLookup,
            (obs['observedRole'] as string | undefined) ?? '',
          ),
          observationDate: formatDate(obs['observationDate']),
          observationName: (obs['observationName'] as string | undefined) ?? '',
          observationType: (obs['type'] as string | undefined) ?? '',
        };

        await sendEmail({
          db,
          to: observerEmail,
          subject: substituteVariables(overdueTemplate.subject, vars),
          html: substituteVariables(overdueTemplate.bodyHtml, vars),
          mailDocId: `overdue-${docSnap.id}-${week}`,
          triggerType: 'scheduled.reminderOverdueFinalize',
          auditDetails: {
            observationId: docSnap.id,
            triggerType: 'scheduled.reminderOverdueFinalize',
          },
        }).catch((err: unknown) =>
          logger.error('scheduledEmailReminders: overdue send failed', err),
        );
      }
      logger.info('scheduledEmailReminders: overdue processed', {
        count: overdueSnap.size,
        daysPast,
      });
    }
  },
);
