import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  APP_SETTINGS_DOC_ID,
  AUDIT_ACTIONS,
  COLLECTIONS,
  renderEmailShell,
  type EmailTemplate,
  type EmailTriggerType,
} from '@ops/shared';

export const APP_URL = 'https://observations.orono.k12.mn.us';
/** Fallback sender — appSettings/global.outboundEmailAddress overrides this at send time. */
const FROM_EMAIL = 'observations@orono.k12.mn.us';

/** Variable bag passed to substituteVariables. Undefined values render as ''. */
export type TemplateVars = Partial<Record<string, string>>;

/** Replace all {{varName}} occurrences in a string with values from the bag. */
export function substituteVariables(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

/**
 * /mail doc id for the "incomplete WP/IR" reminder.
 *
 * Keyed on the reminder's run date (Chicago YYYY-MM-DD) so the daily job can
 * re-send a fresh nudge each day an observation stays incomplete. The Trigger
 * Email extension only sends on /mail doc *creation*, so a fully-static id
 * (just the observationId) would silently no-op every run after the first. The
 * per-day key keeps a single day's run idempotent (safe on retries) while
 * still allowing the next day's resend.
 */
export function incompleteReminderMailDocId(observationId: string, runDateYMD: string): string {
  return `incomplete-${observationId}-${runDateYMD}`;
}

/**
 * Decide whether the daily scheduler should send an incomplete-WP/IR reminder
 * for this observation today.
 *
 * Logic:
 *   - The *first* reminder fires on the day that is exactly `scheduledDays`
 *     after the observation was created (day 0 of nudges).
 *   - Each subsequent day is nudge day 1, 2, …, up to (maxReminders - 1).
 *   - On day `maxReminders` and beyond the function returns false — the cap
 *     has been reached and no more emails are sent.
 *
 * This is a pure function so it can be unit-tested without Firestore.
 *
 * @param daysSinceCreation  Calendar days between the observation's creation
 *                           date and the current run date (Chicago dates).
 * @param scheduledDays      Days after creation before the first reminder fires
 *                           (matches EmailTemplate.scheduledDays, e.g. 3).
 * @param maxReminders       Maximum number of nudges to send in total
 *                           (matches EmailTemplate.maxReminders, e.g. 5).
 * @returns true when a reminder should be sent today.
 */
export function shouldSendIncompleteReminder(
  daysSinceCreation: number,
  scheduledDays: number,
  maxReminders: number,
): boolean {
  // Days into the nudge window: 0 = first eligible day, 1 = second, etc.
  const nudgeDay = daysSinceCreation - scheduledDays;
  return nudgeDay >= 0 && nudgeDay < maxReminders;
}

/**
 * /mail doc id for a staff-invite email.
 *
 * Includes the send timestamp so re-inviting a staff member (e.g. after a
 * delete + re-create, or a re-activation) creates a *new* /mail doc and
 * actually re-sends. A static `invite-<email>` id would collide with the
 * earlier invite and silently no-op (the Trigger Email extension only sends on
 * doc creation).
 */
export function staffInviteMailDocId(email: string, nowMs: number): string {
  return `invite-${email.replace('@', '-at-')}-${String(nowMs)}`;
}

/**
 * /mail doc id for a *resent* window-invite email.
 *
 * Mirrors createObservationWindow.windowInviteMailDocId but adds a `-resend`
 * marker and the send timestamp so a resend never collides with the original
 * static invite id (which would silently no-op — the Trigger Email extension
 * only sends on doc creation). Keyed per invitee entry (email + building) and
 * per instant so the same person can be resent at two buildings, and the same
 * entry can be resent repeatedly.
 */
export function resendWindowInviteMailDocId(
  windowId: string,
  email: string,
  buildingId: string,
  nowMs: number,
): string {
  return `scheduling.windowInvite-resend-${windowId}-${email}-${buildingId}-${String(nowMs)}`;
}

/**
 * Load an active template for a given trigger type.
 * Returns null if no active template exists for this trigger.
 *
 * When multiple active templates share a trigger (which the admin UI
 * discourages with a warning), this picks the most-recently-updated one
 * deterministically rather than letting Firestore choose arbitrarily.
 * The compound index on (triggerType ASC, isActive ASC, updatedAt DESC) in
 * firestore.indexes.json backs this query.
 */
export async function loadActiveTemplate(
  db: Firestore,
  triggerType: EmailTriggerType,
): Promise<(EmailTemplate & { id: string }) | null> {
  const snap = await db
    .collection(COLLECTIONS.emailTemplates)
    .where('triggerType', '==', triggerType)
    .where('isActive', '==', true)
    .orderBy('updatedAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  // snap.empty guard above ensures docs[0] exists
  const doc = snap.docs[0]!;
  return { id: doc.id, ...(doc.data() as EmailTemplate) };
}

/**
 * Load branding bits needed to render the email shell, plus the sender
 * address. One settings read serves both: the from address comes from the
 * admin-editable appSettings/global.outboundEmailAddress, falling back to
 * FROM_EMAIL when unset or blank.
 */
async function loadEmailBranding(
  db: Firestore,
): Promise<{ appName: string; logoUrl: string | null; fromEmail: string }> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const data = snap.data();
  const branding = data?.['branding'] as { appName?: string; logoUrl?: string | null } | undefined;
  const outbound = data?.['outboundEmailAddress'] as string | undefined;
  return {
    appName: branding?.appName ?? 'Orono Peer Observations',
    logoUrl: branding?.logoUrl ?? null,
    fromEmail:
      typeof outbound === 'string' && outbound.trim() !== '' ? outbound.trim() : FROM_EMAIL,
  };
}

/**
 * Load the security admin email from appSettings/global.
 *
 * Returns the trimmed address when set, or `null` when the field is absent,
 * blank, or the settings doc does not exist. Callers should skip sending when
 * null is returned.
 *
 * Used to resolve `recipient === 'admin'` in templated emails and to direct
 * security-event alerts (rejected sign-ins, rate-limit trips, etc.).
 */
export async function loadSecurityAdminEmail(db: Firestore): Promise<string | null> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const raw = snap.data()?.['securityAdminEmail'] as string | undefined;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return raw.trim();
}

/**
 * Core send: wraps the content HTML in the branded email shell, writes a
 * document to /mail which the Trigger Email extension picks up and sends
 * immediately, and writes an audit log entry. Every templated/manual/
 * scheduled email funnels through here, so the shell is applied uniformly.
 */
export async function sendEmail(args: {
  db: Firestore;
  to: string | string[];
  subject: string;
  html: string;
  mailDocId: string;
  auditDetails?: Record<string, unknown>;
}): Promise<void> {
  const { db, to, subject, html, mailDocId, auditDetails } = args;
  const recipients = Array.isArray(to) ? to : [to];

  const branding = await loadEmailBranding(db);
  const wrappedHtml = renderEmailShell(html, {
    appName: branding.appName,
    logoUrl: branding.logoUrl,
    signInLink: APP_URL,
  });

  await db.collection(COLLECTIONS.mail).doc(mailDocId).set({
    to: recipients,
    from: branding.fromEmail,
    message: { subject, html: wrappedHtml },
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: FieldValue.serverTimestamp(),
    userEmail: branding.fromEmail,
    action: AUDIT_ACTIONS.emailSent,
    target: `mail/${mailDocId}`,
    details: {
      to: recipients,
      subject,
      mailDocId,
      ...auditDetails,
    },
  });

  logger.info('emailUtils: sent', { mailDocId, to: recipients, subject });
}

/**
 * High-level helper: load the active template for a trigger type,
 * substitute variables, and send. Returns false if no active template.
 *
 * When the template's `recipient` is `'admin'`, the `to` argument is
 * ignored and the email is instead directed to the security admin address
 * from appSettings/global.securityAdminEmail. If that field is unset the
 * send is skipped and this function returns false.
 */
export async function sendTemplatedEmail(args: {
  db: Firestore;
  triggerType: EmailTriggerType;
  to: string | string[];
  vars: TemplateVars;
  mailDocId: string;
  auditDetails?: Record<string, unknown>;
}): Promise<boolean> {
  const { db, triggerType, to, vars, mailDocId, auditDetails } = args;

  const template = await loadActiveTemplate(db, triggerType);
  if (!template) {
    logger.info('emailUtils: no active template for trigger', { triggerType });
    return false;
  }

  const appSettingsSnap = await db
    .doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`)
    .get();
  const appSettingsData = appSettingsSnap.data();
  const appName: string =
    (appSettingsData?.['branding']?.['appName'] as string | undefined) ??
    'Orono Peer Observations';
  const signupLink: string = (appSettingsData?.['signupLink'] as string | undefined) ?? '';

  // Resolve the recipient address: 'admin' → securityAdminEmail from settings.
  let resolvedTo: string | string[];
  if (template.recipient === 'admin') {
    const securityAdminEmail = appSettingsData?.['securityAdminEmail'] as string | undefined;
    if (!securityAdminEmail || securityAdminEmail.trim() === '') {
      logger.info('emailUtils: recipient=admin but securityAdminEmail is unset; skipping', {
        triggerType,
        mailDocId,
      });
      return false;
    }
    resolvedTo = securityAdminEmail.trim();
  } else {
    resolvedTo = to;
  }

  const fullVars: TemplateVars = {
    appName,
    signInLink: APP_URL,
    signupLink,
    ...vars,
  };

  const subject = substituteVariables(template.subject, fullVars);
  const html = substituteVariables(template.bodyHtml, fullVars);

  await sendEmail({
    db,
    to: resolvedTo,
    subject,
    html,
    mailDocId,
    ...(auditDetails !== undefined ? { auditDetails } : {}),
  });
  return true;
}

/** Format a Firestore Timestamp or Date as a readable date string. */
export function formatDate(value: unknown): string {
  if (!value) return '';
  const d =
    typeof value === 'object' && 'toDate' in (value as object)
      ? (value as { toDate(): Date }).toDate()
      : value instanceof Date
        ? value
        : null;
  if (!d) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
