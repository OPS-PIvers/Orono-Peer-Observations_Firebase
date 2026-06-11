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
 * Load an active template for a given trigger type.
 * Returns null if no active template exists for this trigger.
 */
export async function loadActiveTemplate(
  db: Firestore,
  triggerType: EmailTriggerType,
): Promise<(EmailTemplate & { id: string }) | null> {
  const snap = await db
    .collection(COLLECTIONS.emailTemplates)
    .where('triggerType', '==', triggerType)
    .where('isActive', '==', true)
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
  const appName: string =
    (appSettingsSnap.data()?.['branding']?.['appName'] as string | undefined) ??
    'Orono Peer Observations';
  const signupLink: string =
    (appSettingsSnap.data()?.['signupLink'] as string | undefined) ?? '';

  const fullVars: TemplateVars = {
    appName,
    signInLink: APP_URL,
    signupLink,
    ...vars,
  };

  const subject = substituteVariables(template.subject, fullVars);
  const html = substituteVariables(template.bodyHtml, fullVars);

  await sendEmail({ db, to, subject, html, mailDocId, ...(auditDetails !== undefined ? { auditDetails } : {}) });
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
