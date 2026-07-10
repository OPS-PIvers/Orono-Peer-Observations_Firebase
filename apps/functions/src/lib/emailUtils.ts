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
    from: FROM_EMAIL,
    message: { subject, html: wrappedHtml },
    createdAt: FieldValue.serverTimestamp(),
  });

  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: FieldValue.serverTimestamp(),
    userEmail: FROM_EMAIL,
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
