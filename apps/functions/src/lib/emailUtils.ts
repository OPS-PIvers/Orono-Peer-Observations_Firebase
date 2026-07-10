import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  APP_SETTINGS_DOC_ID,
  AUDIT_ACTIONS,
  COLLECTIONS,
  DEFAULT_EMAIL_PREFERENCES,
  EMAIL_TRIGGER_CATEGORY,
  isCriticalEmailTrigger,
  renderEmailShell,
  type EmailPreferences,
  type EmailTemplate,
  type EmailTriggerType,
} from '@ops/shared';

export const APP_URL = 'https://observations.orono.k12.mn.us';
const FROM_EMAIL = 'observations@orono.k12.mn.us';

/** Variable bag passed to substituteVariables. Undefined values render as ''. */
export type TemplateVars = Partial<Record<string, string>>;

/**
 * HTML-escape a substituted value. Template bodies are HTML, and the values
 * substituted in (staff names, cancellation reasons, etc.) are user-editable
 * Firestore fields — escape by default so they can't inject markup into an
 * email sent to someone else. Safe both in text-node and `href="..."`
 * attribute contexts (see emailBodyHtml.ts / renderEmailShell.ts).
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replace all {{varName}} occurrences in a string with values from the bag,
 *  HTML-escaping each substituted value. */
export function substituteVariables(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(vars[key] ?? ''));
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

/** Load branding bits needed to render the email shell. */
async function loadEmailBranding(
  db: Firestore,
): Promise<{ appName: string; logoUrl: string | null }> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const branding = snap.data()?.['branding'] as
    | { appName?: string; logoUrl?: string | null }
    | undefined;
  return {
    appName: branding?.appName ?? 'Orono Peer Observations',
    logoUrl: branding?.logoUrl ?? null,
  };
}

/**
 * Load a staff member's saved email preferences. Falls back to the
 * all-opted-in defaults if the staff doc doesn't exist or predates the
 * emailPreferences field, so an unknown/legacy recipient is never silently
 * suppressed.
 */
async function loadEmailPreferences(db: Firestore, recipientEmail: string): Promise<EmailPreferences> {
  const snap = await db.doc(`${COLLECTIONS.staff}/${recipientEmail.toLowerCase()}`).get();
  const prefs = snap.data()?.['emailPreferences'] as Partial<EmailPreferences> | undefined;
  return { ...DEFAULT_EMAIL_PREFERENCES, ...prefs };
}

/**
 * True if `recipientEmail` has opted out of the preference category that
 * governs `triggerType`. Critical trigger types (booking confirmations,
 * cancellations/reschedules, staff invites, role/year changes) are never
 * suppressible and always return false.
 */
export async function isEmailSuppressed(
  db: Firestore,
  recipientEmail: string,
  triggerType: EmailTriggerType,
): Promise<boolean> {
  if (isCriticalEmailTrigger(triggerType)) return false;
  const category = EMAIL_TRIGGER_CATEGORY[triggerType];
  if (!category) return false; // unmapped + non-critical: treat as always-send
  const prefs = await loadEmailPreferences(db, recipientEmail);
  return prefs[category] === false;
}

/** Outcome of a sendEmail call, so callers (e.g. sendManualEmail) can tell
 *  a queued send from one fully suppressed by recipient preferences. */
export interface SendEmailResult {
  /** True when a /mail doc was written (at least one recipient remained). */
  queued: boolean;
  /** Recipients the email was actually queued for. */
  to: string[];
  /** Recipients dropped because they opted out of this email category. */
  suppressed: string[];
}

/**
 * Core send: wraps the content HTML in the branded email shell, writes a
 * document to /mail which the Trigger Email extension picks up and sends
 * immediately, and writes an `emailSent` audit log entry. Every templated/
 * manual/scheduled email funnels through here, so the shell is applied
 * uniformly.
 *
 * Before queueing, each recipient is checked against their saved email
 * preferences (see isEmailSuppressed) unless `triggerType` is a critical,
 * always-on trigger. Recipients who opted out are dropped from the send; if
 * every recipient opted out, nothing is queued and an `emailSuppressed`
 * audit entry is written instead of `emailSent`. The returned
 * SendEmailResult reports exactly who was queued vs suppressed.
 *
 * The audit entry written here records that the /mail doc was *queued*,
 * not that delivery succeeded — see the NOTE above the auditLog.add() call
 * below, and onMailWritten.ts for the failure-side of this story.
 */
export async function sendEmail(args: {
  db: Firestore;
  to: string | string[];
  subject: string;
  html: string;
  mailDocId: string;
  triggerType: EmailTriggerType;
  auditDetails?: Record<string, unknown>;
}): Promise<SendEmailResult> {
  const { db, to, subject, html, mailDocId, triggerType, auditDetails } = args;
  const requested = (Array.isArray(to) ? to : [to]).filter(Boolean);

  const suppressed: string[] = [];
  const recipients: string[] = [];
  if (isCriticalEmailTrigger(triggerType) || !EMAIL_TRIGGER_CATEGORY[triggerType]) {
    recipients.push(...requested);
  } else {
    const flags = await Promise.all(
      requested.map((recipient) => isEmailSuppressed(db, recipient, triggerType)),
    );
    requested.forEach((recipient, i) => {
      (flags[i] ? suppressed : recipients).push(recipient);
    });
  }

  if (recipients.length === 0) {
    logger.info('emailUtils: all recipients suppressed, skipping send', {
      mailDocId,
      suppressed,
      triggerType,
    });
    if (suppressed.length > 0) {
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: FieldValue.serverTimestamp(),
        userEmail: FROM_EMAIL,
        action: AUDIT_ACTIONS.emailSuppressed,
        target: `mail/${mailDocId}`,
        details: { to: suppressed, subject, mailDocId, triggerType, ...auditDetails },
      });
    }
    return { queued: false, to: [], suppressed };
  }

  const branding = await loadEmailBranding(db);
  const wrappedHtml = renderEmailShell(html, {
    appName: branding.appName,
    logoUrl: branding.logoUrl,
    signInLink: APP_URL,
    preferencesLink: `${APP_URL}/profile#email-preferences`,
  });

  await db.collection(COLLECTIONS.mail).doc(mailDocId).set({
    to: recipients,
    from: FROM_EMAIL,
    message: { subject, html: wrappedHtml },
    createdAt: FieldValue.serverTimestamp(),
  });

  // NOTE: this only confirms the /mail doc was *queued* for the Trigger
  // Email extension — it fires before the extension has attempted SMTP
  // delivery, so `emailSent` means "handed off", not "delivered". The
  // extension writes back a `delivery.state`/`delivery.error` on this same
  // doc once it actually attempts the send; onMailWritten (apps/functions/
  // src/email/onMailWritten.ts) watches for `delivery.state === 'ERROR'`
  // and writes a separate `AUDIT_ACTIONS.emailDeliveryFailed` entry with the
  // same `target` (`mail/${mailDocId}`) so the two can be correlated and a
  // bounce/block doesn't get mistaken for a successful send.
  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: FieldValue.serverTimestamp(),
    userEmail: FROM_EMAIL,
    action: AUDIT_ACTIONS.emailSent,
    target: `mail/${mailDocId}`,
    details: {
      to: recipients,
      subject,
      mailDocId,
      ...(suppressed.length > 0 ? { suppressed } : {}),
      ...auditDetails,
    },
  });

  logger.info('emailUtils: queued', { mailDocId, to: recipients, subject });
  return { queued: true, to: recipients, suppressed };
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

  await sendEmail({
    db,
    to,
    subject,
    html,
    mailDocId,
    triggerType,
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
