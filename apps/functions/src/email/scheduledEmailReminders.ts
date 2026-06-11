import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, OBSERVATION_TYPES, type Role } from '@ops/shared';
import {
  formatDate,
  incompleteReminderMailDocId,
  loadActiveTemplate,
  loadSecurityAdminEmail,
  sendEmail,
  shouldSendIncompleteReminder,
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
 * /mail doc id for the "unacknowledged observation" reminder.
 *
 * Keyed on the run date (Chicago YYYY-MM-DD) so the daily job can re-send
 * a fresh nudge each day an observation stays unacknowledged, up to the
 * maxReminders cap (same logic as the incomplete-reminder phase).
 * A per-day key keeps a single day's run idempotent (safe on retries).
 *
 * Exported for unit tests.
 */
export function unacknowledgedReminderMailDocId(observationId: string, runDateYMD: string): string {
  return `unacked-${observationId}-${runDateYMD}`;
}

/**
 * Daily scheduled job that sends three types of reminder emails:
 *   1. Pre-observation reminders N days before a Draft observation's date.
 *   2. Incomplete WP/IR reminders N days after creation with no responses.
 *   3. Unacknowledged-observation reminders N days after finalizedAt with
 *      no staff acknowledgement, capped at maxReminders total nudges.
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

      // Resolve admin address once before the loop — all per-observation emails
      // share the same destination when recipient === 'admin'.
      const preObsAdminEmail =
        preObsTemplate.recipient === 'admin' ? await loadSecurityAdminEmail(db) : null;
      if (preObsTemplate.recipient === 'admin' && preObsAdminEmail === null) {
        logger.info(
          'scheduledEmailReminders: preObs template recipient=admin but securityAdminEmail is unset; skipping',
        );
      } else {
        const snap = await db
          .collection(COLLECTIONS.observations)
          .where('status', '==', OBSERVATION_STATUS.draft)
          .where('observationDate', '>=', Timestamp.fromDate(targetStart))
          .where('observationDate', '<=', Timestamp.fromDate(targetEnd))
          .get();

        for (const docSnap of snap.docs) {
          const obs = docSnap.data();
          const observerNameRaw = (obs['observerName'] as string | undefined) ?? '';
          const vars = {
            observerName:
              observerNameRaw !== ''
                ? observerNameRaw
                : ((obs['observerEmail'] as string | undefined)?.split('@')[0] ?? ''),
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

          // Resolve the recipient address for this observation.
          // When recipient === 'admin', preObsAdminEmail is guaranteed non-null
          // (the outer else-branch only runs when it is non-null or recipient !== 'admin').
          let recipient: string | string[];
          if (preObsTemplate.recipient === 'admin' && preObsAdminEmail !== null) {
            recipient = preObsAdminEmail;
          } else if (preObsTemplate.recipient === 'observer') {
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
            auditDetails: { observationId: docSnap.id, triggerType: 'scheduled.preObservation' },
          }).catch((err: unknown) =>
            logger.error('scheduledEmailReminders: preObs send failed', err),
          );
        }
        logger.info('scheduledEmailReminders: preObs processed', { count: snap.size, daysAhead });
      }
    }

    // ── 2. Incomplete WP / IR reminders ──────────────────────────────
    const incompleteTemplate = await loadActiveTemplate(db, 'scheduled.reminderIncomplete');
    if (incompleteTemplate) {
      const daysAfter = incompleteTemplate.scheduledDays;
      const maxReminders = incompleteTemplate.maxReminders;
      // Chicago run date keys the mail doc id so the nudge re-sends daily until
      // the observation is completed or the cap is reached (see
      // incompleteReminderMailDocId / shouldSendIncompleteReminder).
      const runDateYMD = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
      }).format(today);
      // Use Chicago midnight as the cutoff so observations created on the same
      // calendar day N days ago are included regardless of time-of-day.
      // The upper bound here covers all observations that are old enough to
      // have received at least one reminder; shouldSendIncompleteReminder then
      // discards observations that have already hit the maxReminders cap.
      const { start: cutoff } = chicagoMidnight(today, -daysAfter);

      const wpIrSnap = await db
        .collection(COLLECTIONS.observations)
        .where('status', '==', OBSERVATION_STATUS.draft)
        .where('type', 'in', [OBSERVATION_TYPES.workProduct, OBSERVATION_TYPES.instructionalRound])
        .where('createdAt', '<=', Timestamp.fromDate(cutoff))
        .get();

      let sentCount = 0;
      let cappedCount = 0;

      for (const docSnap of wpIrSnap.docs) {
        const obs = docSnap.data();
        const answers: unknown[] = Array.isArray(obs['workProductAnswers'])
          ? (obs['workProductAnswers'] as unknown[])
          : [];
        const hasAnyAnswer = answers.some(
          (a) =>
            typeof a === 'object' && a !== null && (a as Record<string, string>)['answer']?.trim(),
        );
        if (hasAnyAnswer) continue;

        if (!obs['observedEmail']) continue;

        // Compute how many calendar days (Chicago) have elapsed since creation.
        // Typed as `unknown` to opt out of `any` propagation for the null/toDate check below.
        // eslint rule: no-unsafe-assignment would fire on `any`; `unknown` is the correct intent.
        const createdAtRaw: unknown = obs['createdAt'];
        const createdAtDate: Date | null =
          createdAtRaw !== null && typeof createdAtRaw === 'object' && 'toDate' in createdAtRaw
            ? (createdAtRaw as { toDate(): Date }).toDate()
            : null;

        if (!createdAtDate) continue;

        const createdDateYMD = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Chicago',
        }).format(createdAtDate);

        // Parse both Chicago date strings as plain calendar days and diff them.
        const [cy, cm, cd] = createdDateYMD.split('-').map(Number) as [number, number, number];
        const [ry, rm, rd] = runDateYMD.split('-').map(Number) as [number, number, number];
        const createdMs = Date.UTC(cy, cm - 1, cd);
        const runMs = Date.UTC(ry, rm - 1, rd);
        const daysSinceCreation = Math.round((runMs - createdMs) / (24 * 60 * 60 * 1000));

        if (!shouldSendIncompleteReminder(daysSinceCreation, daysAfter, maxReminders)) {
          cappedCount++;
          continue;
        }

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
          mailDocId: incompleteReminderMailDocId(docSnap.id, runDateYMD),
          auditDetails: { observationId: docSnap.id, triggerType: 'scheduled.reminderIncomplete' },
        }).catch((err: unknown) =>
          logger.error('scheduledEmailReminders: incomplete send failed', err),
        );

        sentCount++;
      }
      logger.info('scheduledEmailReminders: incomplete processed', {
        total: wpIrSnap.size,
        sent: sentCount,
        capped: cappedCount,
      });
    }

    // ── 3. Unacknowledged finalized-observation reminders ─────────────
    const unackedTemplate = await loadActiveTemplate(db, 'scheduled.reminderUnacknowledged');
    if (unackedTemplate) {
      const daysAfterFinalized = unackedTemplate.scheduledDays;
      const maxUnackedReminders = unackedTemplate.maxReminders;
      // Chicago run date keys the mail doc id (idempotent within one run,
      // re-sends on subsequent days until acknowledged or cap reached).
      const runDateYMD = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
      }).format(today);
      // Cutoff: Chicago midnight N days ago — observations finalized on or
      // before this date are eligible for their first nudge today.
      const { start: unackedCutoff } = chicagoMidnight(today, -daysAfterFinalized);

      // Query: Finalized observations with no acknowledgedAt, finalized at or
      // before the cutoff. The composite index
      //   (status ASC, acknowledgedAt ASC, finalizedAt ASC)
      // declared in firestore.indexes.json backs this query.
      // acknowledgedAt is stored as null when unacknowledged; Firestore
      // treats null as the lowest ordered value so `== null` combined with
      // a range filter on finalizedAt is supported by that index.
      const unackedSnap = await db
        .collection(COLLECTIONS.observations)
        .where('status', '==', OBSERVATION_STATUS.finalized)
        .where('acknowledgedAt', '==', null)
        .where('finalizedAt', '<=', Timestamp.fromDate(unackedCutoff))
        .get();

      let unackedSentCount = 0;
      let unackedCappedCount = 0;

      for (const docSnap of unackedSnap.docs) {
        const obs = docSnap.data();

        if (!obs['observedEmail']) continue;

        // Compute calendar days (Chicago) since finalizedAt.
        const finalizedAtRaw: unknown = obs['finalizedAt'];
        const finalizedAtDate: Date | null =
          finalizedAtRaw !== null &&
          typeof finalizedAtRaw === 'object' &&
          'toDate' in finalizedAtRaw
            ? (finalizedAtRaw as { toDate(): Date }).toDate()
            : null;

        if (!finalizedAtDate) continue;

        const finalizedDateYMD = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Chicago',
        }).format(finalizedAtDate);

        const [fy, fm, fd] = finalizedDateYMD.split('-').map(Number) as [number, number, number];
        const [ry, rm, rd] = runDateYMD.split('-').map(Number) as [number, number, number];
        const finalizedMs = Date.UTC(fy, fm - 1, fd);
        const runMs = Date.UTC(ry, rm - 1, rd);
        const daysSinceFinalized = Math.round((runMs - finalizedMs) / (24 * 60 * 60 * 1000));

        if (
          !shouldSendIncompleteReminder(daysSinceFinalized, daysAfterFinalized, maxUnackedReminders)
        ) {
          unackedCappedCount++;
          continue;
        }

        const observerNameRaw = (obs['observerName'] as string | undefined) ?? '';
        const vars = {
          observedName: (obs['observedName'] as string | undefined) ?? '',
          observedEmail: (obs['observedEmail'] as string | undefined) ?? '',
          observedRole: resolveRoleLabel(
            rolesLookup,
            (obs['observedRole'] as string | undefined) ?? '',
          ),
          observedYear: String(obs['observedYear'] ?? ''),
          observerName:
            observerNameRaw !== ''
              ? observerNameRaw
              : ((obs['observerEmail'] as string | undefined)?.split('@')[0] ?? ''),
          observerEmail: (obs['observerEmail'] as string | undefined) ?? '',
          observationDate: formatDate(obs['observationDate']),
          observationName: (obs['observationName'] as string | undefined) ?? '',
          observationType: (obs['type'] as string | undefined) ?? '',
          pdfDriveLink: (obs['pdfDriveLink'] as string | undefined) ?? '',
          driveFolderLink: (obs['driveFolderLink'] as string | undefined) ?? '',
        };

        // Resolve recipient address (observed / observer / both / admin).
        const unackedAdminEmail =
          unackedTemplate.recipient === 'admin' ? await loadSecurityAdminEmail(db) : null;

        if (unackedTemplate.recipient === 'admin' && unackedAdminEmail === null) {
          logger.info(
            'scheduledEmailReminders: unacked template recipient=admin but securityAdminEmail is unset; skipping',
          );
          continue;
        }

        let recipient: string | string[];
        if (unackedTemplate.recipient === 'admin' && unackedAdminEmail !== null) {
          recipient = unackedAdminEmail;
        } else if (unackedTemplate.recipient === 'observer') {
          recipient = (obs['observerEmail'] as string | undefined) ?? '';
        } else if (unackedTemplate.recipient === 'both') {
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
          subject: substituteVariables(unackedTemplate.subject, vars),
          html: substituteVariables(unackedTemplate.bodyHtml, vars),
          mailDocId: unacknowledgedReminderMailDocId(docSnap.id, runDateYMD),
          auditDetails: {
            observationId: docSnap.id,
            triggerType: 'scheduled.reminderUnacknowledged',
          },
        }).catch((err: unknown) =>
          logger.error('scheduledEmailReminders: unacked send failed', err),
        );

        unackedSentCount++;
      }
      logger.info('scheduledEmailReminders: unacked processed', {
        total: unackedSnap.size,
        sent: unackedSentCount,
        capped: unackedCappedCount,
      });
    }
  },
);
