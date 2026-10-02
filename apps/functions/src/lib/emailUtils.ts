import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import {
  APP_SETTINGS_DOC_ID,
  AUDIT_ACTIONS,
  COLLECTIONS,
  DEFAULT_EMAIL_PREFERENCES,
  EMAIL_TRIGGER_CATEGORY,
  firstNameOf,
  formatPersonName,
  isCriticalEmailTrigger,
  renderEmailShell,
  sanitizeHtmlHrefs,
  type EmailPreferences,
  type EmailTemplate,
  type EmailTriggerType,
} from '@ops/shared';
import { isDemoStaff } from './callable.js';

// The Firebase Hosting default domain. No custom domain is wired up yet —
// if one is, change it here; every email link is built from this.
export const APP_URL = 'https://peer-evaluator-rubric.web.app';
/** Packaged app icon (apps/web/public/brand), used when branding has none. */
const DEFAULT_ICON_URL = `${APP_URL}/brand/torch-icon.png`;
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

/** Person-name variables, each paired with a `<prefix>FirstName` greeting
 *  variable derived from it. */
const PERSON_NAME_VARS = ['observedName', 'observerName', 'staffName'] as const;

/**
 * Normalize person-name variables for display ("IVERS, PAUL" → "Paul Ivers")
 * and derive the matching first-name variables ("Paul"). An explicitly passed
 * first-name variable wins.
 */
export function withPersonNameVars(vars: TemplateVars): TemplateVars {
  const out: TemplateVars = { ...vars };
  for (const key of PERSON_NAME_VARS) {
    const raw = vars[key];
    if (!raw) continue;
    out[key] = formatPersonName(raw);
    const firstKey = key.replace(/Name$/, 'FirstName');
    out[firstKey] ??= firstNameOf(raw);
  }
  return out;
}

/** Replace all {{varName}} occurrences in a string with values from the bag,
 *  HTML-escaping each substituted value. Person names are normalized and the
 *  first-name variables derived here (withPersonNameVars), so every send path
 *  gets them — including callers that build their own var bag. */
export function substituteVariables(template: string, vars: TemplateVars): string {
  const all = withPersonNameVars(vars);
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(all[key] ?? ''));
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
  const doc = snap.docs[0];
  if (!doc) return null;
  return { id: doc.id, ...(doc.data() as EmailTemplate) };
}

/** Load branding bits needed to render the email shell. */
async function loadEmailBranding(
  db: Firestore,
): Promise<{ appName: string; logoUrl: string | null; iconUrl: string }> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const branding = snap.data()?.['branding'] as
    | { appName?: string; logoUrl?: string | null; iconUrl?: string | null }
    | undefined;
  return {
    appName: branding?.appName ?? 'Orono Peer Observations',
    logoUrl: branding?.logoUrl ?? null,
    iconUrl: branding?.iconUrl ?? DEFAULT_ICON_URL,
  };
}

/**
 * Load a staff member's saved email preferences. Falls back to the
 * all-opted-in defaults if the staff doc doesn't exist or predates the
 * emailPreferences field, so an unknown/legacy recipient is never silently
 * suppressed.
 */
async function loadEmailPreferences(
  db: Firestore,
  recipientEmail: string,
): Promise<EmailPreferences> {
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
  return !prefs[category];
}

/** A file attached to an outgoing email, in the Trigger Email extension's
 *  (nodemailer) attachment shape. Stored inline on the /mail doc, so keep it
 *  well under Firestore's 1 MiB document limit. */
export interface EmailAttachment {
  filename: string;
  content: string;
  encoding: 'base64';
  contentType: string;
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
 * Resolve the configured security-admin email from /appSettings, or null when
 * unset. Used to direct security/ops alerts (rejected sign-ins, rate-limit
 * trips, Drive-quota warnings) to a monitored inbox.
 */
export async function loadSecurityAdminEmail(db: Firestore): Promise<string | null> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const raw = snap.data()?.['securityAdminEmail'] as string | undefined;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return raw.trim();
}

/**
 * Reasonable email-address format check for any value that reaches the mail
 * pipeline as a `from` or `replyTo` address — whether read raw from
 * Firestore (which bypasses the Zod schema's `z.email()` check entirely, see
 * the doc comment on loadOutboundEmailSettings below) or passed in as a
 * per-send override argument by a caller. This is what first gives those
 * values real send-time effect, so a malformed value — or worse, one
 * carrying a literal CR/LF (a classic header-injection vector) — must be
 * rejected here rather than written straight into the `/mail` doc.
 * Deliberately NOT restricted to the district's domain: any well-formed
 * address is allowed (PLAT-05 decision).
 */
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isSendableEmailAddress(value: string): boolean {
  return !/[\r\n]/.test(value) && EMAIL_FORMAT_RE.test(value);
}

/**
 * Trim + format-validate a reply-to candidate from either source that can
 * supply one — the per-send override argument to `sendEmail`, or the
 * configured `/appSettings.replyToEmail` default — through the exact same
 * path, so neither is validated more strictly than the other. An empty or
 * malformed candidate normalizes to `undefined` ("no reply-to"); it is never
 * thrown, only logged.
 */
function normalizeReplyToCandidate(
  candidate: string | undefined,
  source: 'per-send override' | 'configured default',
): string | undefined {
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  if (trimmed === '') return undefined;
  if (!isSendableEmailAddress(trimmed)) {
    logger.warn('emailUtils: replyTo address failed format validation, omitting', {
      source,
      rejected: trimmed,
    });
    return undefined;
  }
  return trimmed;
}

/**
 * Resolve the outbound "from" address and optional default reply-to address
 * from /appSettings, in a single read.
 *
 * A raw Admin-SDK read bypasses the Zod schema's `.default()` (same caveat as
 * loadEmailBranding/loadSecurityAdminEmail above), so a missing or blank
 * `outboundEmailAddress` field falls back explicitly to the hardcoded
 * FROM_EMAIL constant rather than relying on the schema default kicking in.
 * A non-blank value that fails `isSendableEmailAddress` (malformed, or
 * carrying a CR/LF) also falls back to FROM_EMAIL, with the rejection
 * logged. `replyToEmail` has no schema default (it's genuinely optional) so
 * a missing or invalid value resolves to `undefined`, meaning "no reply-to
 * override."
 */
async function loadOutboundEmailSettings(
  db: Firestore,
): Promise<{ fromEmail: string; replyTo: string | undefined }> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const data = snap.data();

  const rawFrom = data?.['outboundEmailAddress'] as string | undefined;
  const trimmedFrom = typeof rawFrom === 'string' ? rawFrom.trim() : '';
  let fromEmail = FROM_EMAIL;
  if (trimmedFrom !== '') {
    if (isSendableEmailAddress(trimmedFrom)) {
      fromEmail = trimmedFrom;
    } else {
      logger.warn(
        'emailUtils: outboundEmailAddress failed format validation, falling back to FROM_EMAIL',
        { rejected: trimmedFrom },
      );
    }
  }

  const replyTo = normalizeReplyToCandidate(
    data?.['replyToEmail'] as string | undefined,
    'configured default',
  );

  return { fromEmail, replyTo };
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
  /** Per-send reply-to override. Falls back to the admin-configured
   *  /appSettings.replyToEmail default when omitted; omitted entirely from
   *  the /mail doc when neither is set. */
  replyTo?: string;
  attachments?: EmailAttachment[];
}): Promise<SendEmailResult> {
  const { db, to, subject, html, mailDocId, triggerType, auditDetails, replyTo, attachments } =
    args;
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
  const { fromEmail, replyTo: defaultReplyTo } = await loadOutboundEmailSettings(db);
  // Both the per-send override and the configured default are routed through
  // normalizeReplyToCandidate — see its doc comment for why that matters.
  const resolvedReplyTo = normalizeReplyToCandidate(replyTo, 'per-send override') ?? defaultReplyTo;

  // Re-validate every href in the (already variable-substituted) body. Input-
  // time validation via toSafeUrl only governs what the link editor writes, so
  // a template body stored before that validation existed -- or written by any
  // path that bypasses the editor, including a substituted variable that
  // itself carries a protocol -- is still untrusted at this point. Sanitizing
  // here puts the trust boundary at the send rather than at whichever write
  // produced the value.
  const { html: safeHtml, rejected: rejectedHrefs } = sanitizeHtmlHrefs(html);
  if (rejectedHrefs.length > 0) {
    logger.warn('emailUtils: unsafe href(s) rewritten to # before send', {
      mailDocId,
      triggerType,
      rejectedHrefs,
    });
  }

  const wrappedHtml = renderEmailShell(safeHtml, {
    appName: branding.appName,
    logoUrl: branding.logoUrl,
    iconUrl: branding.iconUrl,
    signInLink: APP_URL,
    preferencesLink: `${APP_URL}/profile#email-preferences`,
  });

  await db
    .collection(COLLECTIONS.mail)
    .doc(mailDocId)
    .set({
      to: recipients,
      from: fromEmail,
      // NOTE: `message.replyTo` is where the Send Email extension adoption
      // decision (still open, see TODO.md) needs to be re-verified against —
      // whatever extension config is ultimately deployed may expect the
      // reply-to on a different field (e.g. a top-level `replyTo`, per the
      // upstream firestore-send-email extension's own doc-shape convention)
      // rather than nested under `message`. Confirm the field name once that
      // decision is made, before assuming this wiring works end-to-end.
      message: {
        subject,
        html: wrappedHtml,
        ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      },
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
      ...(attachments && attachments.length > 0
        ? { attachments: attachments.map((a) => a.filename) }
        : {}),
      // Persist the security-relevant rewrite, not just the log line, so a
      // stored body that still carries an unsafe href is discoverable after
      // the fact rather than only in Cloud Logging retention.
      ...(rejectedHrefs.length > 0 ? { rejectedHrefs } : {}),
      ...auditDetails,
    },
  });

  logger.info('emailUtils: queued', { mailDocId, to: recipients, subject });
  return { queued: true, to: recipients, suppressed };
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
 * Mirrors createObservationWindow's window-invite id but adds a `-resend`
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
 * Append `block.html` to a rendered template body unless the template already
 * references `{{<block.unlessUses>}}` — so a required call to action (e.g. the
 * finalized email's "Acknowledge receipt" button) is always present, without
 * doubling up when an admin has placed it in the template themselves.
 */
export function withRequiredBlock(
  templateBodyHtml: string,
  renderedHtml: string,
  block: { html: string; unlessUses: string } | undefined,
): string {
  if (!block) return renderedHtml;
  if (templateBodyHtml.includes(`{{${block.unlessUses}}}`)) return renderedHtml;
  return `${renderedHtml}\n${block.html}`;
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
  attachments?: EmailAttachment[];
  /** Appended after the template body unless the template uses
   *  `{{<unlessUses>}}` itself — see withRequiredBlock. Already-rendered
   *  HTML; not variable-substituted. */
  requiredBlock?: { html: string; unlessUses: string };
}): Promise<boolean> {
  const { db, triggerType, to, vars, mailDocId, auditDetails, attachments, requiredBlock } = args;

  // Demo people (isDemo, e.g. Sample Teacher) are for walkthrough videos:
  // nothing about them is emailed — not to them, and not to the real staff
  // (an observer, say) on the same message. Logged as suppressed instead.
  const involved = [
    ...(Array.isArray(to) ? to : [to]),
    vars['observedEmail'],
    vars['staffEmail'],
    auditDetails?.['observedEmail'],
  ].filter((e): e is string => typeof e === 'string' && e.includes('@'));
  for (const email of new Set(involved.map((e) => e.toLowerCase()))) {
    if (await isDemoStaff(db, email)) {
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: FieldValue.serverTimestamp(),
        userEmail: FROM_EMAIL,
        action: AUDIT_ACTIONS.emailSuppressed,
        target: `mail/${mailDocId}`,
        details: { to, mailDocId, triggerType, reason: 'demo', demoEmail: email, ...auditDetails },
      });
      logger.info('emailUtils: suppressed email involving a demo person', { triggerType, email });
      return false;
    }
  }

  const template = await loadActiveTemplate(db, triggerType);
  if (!template) {
    logger.info('emailUtils: no active template for trigger', { triggerType });
    return false;
  }

  const appSettingsSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const branding = appSettingsSnap.data()?.['branding'] as { appName?: string } | undefined;
  const appName: string = branding?.appName ?? 'Orono Peer Observations';
  const signupLink: string = (appSettingsSnap.data()?.['signupLink'] as string | undefined) ?? '';

  const fullVars: TemplateVars = {
    appName,
    signInLink: APP_URL,
    signupLink,
    ...vars,
  };

  const subject = substituteVariables(template.subject, fullVars);
  const html = withRequiredBlock(
    template.bodyHtml,
    substituteVariables(template.bodyHtml, fullVars),
    requiredBlock,
  );

  await sendEmail({
    db,
    to,
    subject,
    html,
    mailDocId,
    triggerType,
    ...(auditDetails !== undefined ? { auditDetails } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
  });
  return true;
}

/** Format a Firestore Timestamp or Date as a readable date string. */
export function formatDate(value: unknown): string {
  if (!value) return '';
  const d =
    typeof value === 'object' && 'toDate' in value
      ? (value as { toDate(): Date }).toDate()
      : value instanceof Date
        ? value
        : null;
  if (!d) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
