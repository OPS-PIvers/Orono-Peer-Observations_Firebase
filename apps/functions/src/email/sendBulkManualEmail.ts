import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { APP_SETTINGS_DOC_ID, COLLECTIONS, type EmailTemplate } from '@ops/shared';
import { callerMeetsAccessLevel } from '../lib/callerAccess.js';
import { sendEmail, substituteVariables } from '../lib/emailUtils.js';
import { RATE_LIMIT_KEYS, checkRateLimit, loadRateLimits } from '../lib/rateLimit.js';

if (getApps().length === 0) initializeApp();

/** One hour, in milliseconds — the manualEmailBroadcastsPerHour window. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * Hard cap on recipients in a single broadcast, independent of the
 * admin-configured per-caller rate limit. This callable is reachable by any
 * PE or admin (see the auth check below, mirrored from sendManualEmail.ts),
 * so a fixed ceiling — not just a throttle — bounds both the worst-case
 * execution time within `timeoutSeconds` and the blast radius of a mistaken
 * or malicious broadcast, regardless of how the rate limit is configured.
 */
export const MAX_BULK_RECIPIENTS = 200;

/**
 * How many staff doc ids one roster-lookup query resolves. Firestore caps an
 * `in` filter at 30 comparison values, so the roster check for a full-size
 * broadcast costs ceil(200 / 30) = 7 queries — a bounded, constant-ish number
 * of round trips rather than one `get()` per recipient.
 */
export const STAFF_LOOKUP_CHUNK_SIZE = 30;

/** How many rejected addresses the error message names before summarizing. */
const MAX_REJECTED_IN_ERROR = 5;

interface SendBulkManualEmailRequest {
  templateId?: string;
  toEmails?: string[];
  vars?: Record<string, string>;
}

export interface SendBulkManualEmailResult {
  /** Deduplicated, valid recipients the request targeted. */
  requested: number;
  /** Recipients an email was actually queued for. */
  sent: number;
  /** Recipients dropped because they opted out of manual messages. */
  suppressed: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalize and de-duplicate a raw recipient list: trims, lowercases,
 * drops anything that doesn't look like an email address, and collapses
 * case-insensitive duplicates. Extracted so the pure logic is unit-testable
 * without an emulator (see sendBulkManualEmail.test.ts).
 */
export function normalizeRecipients(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const normalized = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
    if (!normalized || !EMAIL_RE.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Split a list into fixed-size chunks (the last one may be short). */
export function chunkList<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Resolves a batch of lowercased staff-doc ids to `id -> isActive`. Ids with no
 * staff doc are simply absent from the returned map.
 *
 * Kept as a narrow function type (mirroring RateLimitTx in lib/rateLimit.ts) so
 * {@link partitionRecipientsByRoster} can be unit-tested with a fake lookup
 * instead of a full Firebase Admin environment.
 */
export type StaffRosterLookup = (ids: readonly string[]) => Promise<Map<string, boolean>>;

/**
 * Split a recipient list into addresses that belong to an *active* staff member
 * and addresses that do not (unknown/external addresses and archived staff).
 *
 * This is the allow-list that makes the callable safe to expose to every PE:
 * without it, `toEmails` is only shape-validated, so any authenticated caller
 * could push up to MAX_BULK_RECIPIENTS messages to arbitrary external addresses
 * from the district's domain using a district template.
 *
 * Reads are bounded: one query per {@link STAFF_LOOKUP_CHUNK_SIZE} recipients.
 */
export async function partitionRecipientsByRoster(
  lookup: StaffRosterLookup,
  recipients: readonly string[],
  chunkSize: number = STAFF_LOOKUP_CHUNK_SIZE,
): Promise<{ allowed: string[]; rejected: string[] }> {
  const maps = await Promise.all(chunkList(recipients, chunkSize).map((ids) => lookup(ids)));
  const roster = new Map<string, boolean>();
  for (const map of maps) {
    for (const [id, isActive] of map) roster.set(id, isActive);
  }
  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const recipient of recipients) {
    (roster.get(recipient) === true ? allowed : rejected).push(recipient);
  }
  return { allowed, rejected };
}

/**
 * Firestore-backed {@link StaffRosterLookup}. Staff doc ids *are* the
 * lowercased email (see packages/shared/src/schema/staff.ts), so a
 * `documentId() in [...]` query resolves a whole chunk in one read with no
 * composite index.
 */
export function firestoreStaffRosterLookup(db: Firestore): StaffRosterLookup {
  return async (ids) => {
    const out = new Map<string, boolean>();
    if (ids.length === 0) return out;
    const snap = await db
      .collection(COLLECTIONS.staff)
      .where(FieldPath.documentId(), 'in', [...ids])
      .get();
    for (const doc of snap.docs) {
      const data = doc.data() as { isActive?: boolean } | undefined;
      // Raw Admin SDK reads bypass the Zod schema, so `isActive`'s default of
      // true is not applied here — fall back explicitly rather than letting a
      // legacy doc without the field read as archived.
      out.set(doc.id.toLowerCase(), data?.isActive !== false);
    }
    return out;
  };
}

/**
 * /mail doc id for one recipient of one broadcast.
 *
 * Every part matters: `broadcastId` is unique per invocation (two callers
 * broadcasting the same template in the same millisecond can't collide), the
 * full address — not just the local part — distinguishes `a@x.org` from
 * `a@y.org`, and `index` is a final tiebreaker within the broadcast. The old
 * `manual-${templateId}-${local}-${Date.now()}` form collided on both counts,
 * and because sendEmail() writes with `.set()`, a collision silently
 * *overwrote* the earlier recipient's mail doc while still reporting both as
 * sent.
 *
 * Idempotency is unchanged from the single-recipient path: ids are unique per
 * send attempt, so a repeat broadcast creates new /mail docs (the Trigger Email
 * extension only sends on document creation).
 */
export function bulkManualMailDocId(args: {
  templateId: string;
  toEmail: string;
  broadcastId: string;
  index: number;
}): string {
  const { templateId, toEmail, broadcastId, index } = args;
  return `manual-${templateId}-${toEmail.replace('@', '-at-')}-${broadcastId}-${String(index)}`;
}

/** Minimal send surface {@link queueBroadcast} needs, so the fan-out is
 *  unit-testable without Firestore. Satisfied by a closure over sendEmail(). */
export type BroadcastSend = (args: {
  to: string;
  mailDocId: string;
}) => Promise<{ queued: boolean }>;

/**
 * Fan a broadcast out to each recipient, giving every one its own /mail doc id,
 * and report who was queued vs suppressed by their email preferences.
 */
export async function queueBroadcast(args: {
  recipients: readonly string[];
  templateId: string;
  broadcastId: string;
  send: BroadcastSend;
}): Promise<{ sent: number; suppressed: string[]; mailDocIds: string[] }> {
  const { recipients, templateId, broadcastId, send } = args;
  const entries = recipients.map((toEmail, index) => ({
    toEmail,
    mailDocId: bulkManualMailDocId({ templateId, toEmail, broadcastId, index }),
  }));
  const results = await Promise.all(
    entries.map(({ toEmail, mailDocId }) => send({ to: toEmail, mailDocId })),
  );
  const suppressed = entries.filter((_, i) => !results[i]?.queued).map((e) => e.toEmail);
  const sent = results.filter((r) => r.queued).length;
  return { sent, suppressed, mailDocIds: entries.map((e) => e.mailDocId) };
}

/** Human-readable "not staff" error, naming a few offenders without echoing a
 *  200-address payload back into an error string. */
export function rejectedRecipientsMessage(rejected: readonly string[]): string {
  const named = rejected.slice(0, MAX_REJECTED_IN_ERROR).join(', ');
  const extra = rejected.length - Math.min(rejected.length, MAX_REJECTED_IN_ERROR);
  const suffix = extra > 0 ? ` (+${String(extra)} more)` : '';
  return `A broadcast can only target active staff members. These addresses are not on the staff roster: ${named}${suffix}`;
}

/** The three checks {@link authorizeBroadcast} runs, injected so the *order*
 *  they run in is unit-testable without an emulator. */
export interface BroadcastGuards {
  /** Resolve a template by id, or null when it doesn't exist. */
  loadTemplate: (templateId: string) => Promise<EmailTemplate | null>;
  rosterLookup: StaffRosterLookup;
  /** Consume one of the caller's hourly broadcast slots. Only ever called for
   *  an otherwise-valid request — see the ordering note below. */
  chargeRateLimit: () => Promise<{ allowed: boolean; max: number }>;
}

/**
 * Run every gate a broadcast must clear, in the order that matters, and return
 * the validated template.
 *
 * Ordering is load-bearing: the template and the recipient allow-list are
 * checked *before* the rate limiter is charged, so a request that was never
 * going to send anything (bad/inactive/non-manual template, or an address that
 * isn't active staff) doesn't burn one of the caller's five hourly slots. This
 * matches requestTranscription.ts and uploadAudio.ts, which both validate the
 * underlying resource before calling checkRateLimit.
 */
export async function authorizeBroadcast(args: {
  templateId: string;
  recipients: readonly string[];
  guards: BroadcastGuards;
}): Promise<EmailTemplate> {
  const { templateId, recipients, guards } = args;

  const template = await guards.loadTemplate(templateId);
  if (!template) throw new HttpsError('not-found', 'Template not found');
  if (!template.isActive) throw new HttpsError('failed-precondition', 'Template is inactive');
  if (template.triggerType !== 'manual') {
    throw new HttpsError('invalid-argument', 'Only manual templates can be sent this way');
  }

  // Recipient allow-list. The UI only ever passes staff addresses, but the
  // callable — not the UI — is the trust boundary, so re-derive the audience
  // from the roster instead of trusting the payload.
  const { rejected } = await partitionRecipientsByRoster(guards.rosterLookup, recipients);
  if (rejected.length > 0) {
    throw new HttpsError('permission-denied', rejectedRecipientsMessage(rejected));
  }

  const decision = await guards.chargeRateLimit();
  if (!decision.allowed) {
    throw new HttpsError(
      'resource-exhausted',
      `Broadcast limit reached (${String(decision.max)}/hour). Try again later.`,
    );
  }

  return template;
}

/**
 * Callable for PEs and admins to broadcast a manual-trigger template to a
 * filtered group of staff in one action — the "Message a group" action in the
 * Staff admin area (apps/web/src/admin/staff). Mirrors sendManualEmail.ts's
 * auth check, template-load, and validation exactly (see PLAT-08), then loops
 * the per-recipient send so each recipient keeps their own mailDocId and their
 * own preference-suppression check — the latter already handled inside
 * sendEmail().
 *
 * Unrestricted callers (any PE or admin, not just admins — see the owner
 * decision this implements) is the reason for the three non-negotiable
 * safeguards here: every address must resolve to an *active* /staff doc (the
 * callable is the trust boundary, not the UI that happens to pass staff
 * addresses), MAX_BULK_RECIPIENTS hard-caps a single broadcast, and a
 * configurable per-caller rate limit (rateLimits.manualEmailBroadcastsPerHour)
 * throttles how often any one caller can trigger a broadcast at all.
 *
 * Auth check: "PE or admin" is resolved via the shared `callerMeetsAccessLevel`
 * helper (../lib/callerAccess.ts, level: 'special'), which also backs
 * sendManualEmail.ts and resendStaffInvite.ts. That helper re-reads the live
 * /staff doc when the token's role claim alone doesn't already qualify, so a
 * staff member granted (or revoked) `hasAdminAccess: true` — which reaches
 * this same admin page's "Message a group" action per
 * packages/shared/src/schema/staff.ts — is authorized (or rejected)
 * immediately, without waiting for their ID token to refresh. See INTEG-AUTHZ.
 *
 * Ordering note: everything that can reject the request — argument shape, the
 * recipient cap, the template, the roster allow-list — is validated *before*
 * checkRateLimit runs, so a malformed request never burns one of the caller's
 * hourly slots. This matches requestTranscription.ts and uploadAudio.ts, which
 * both validate the underlying resource before charging the limiter.
 */
export const sendBulkManualEmail = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const db = getFirestore();

    const callerRole = request.auth.token['role'] as string | undefined;
    const hasSpecialAccess = await callerMeetsAccessLevel(db, {
      email: callerEmail,
      tokenRole: callerRole,
      level: 'special',
    });
    if (!hasSpecialAccess) {
      throw new HttpsError('permission-denied', 'Only PEs and admins can send manual emails');
    }

    const { templateId, toEmails, vars } = (request.data ?? {}) as SendBulkManualEmailRequest;
    if (!templateId || !Array.isArray(toEmails) || toEmails.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'templateId and a non-empty toEmails array are required',
      );
    }

    const recipients = normalizeRecipients(toEmails);
    if (recipients.length === 0) {
      throw new HttpsError('invalid-argument', 'No valid recipient email addresses were provided');
    }
    if (recipients.length > MAX_BULK_RECIPIENTS) {
      throw new HttpsError(
        'invalid-argument',
        `A broadcast can target at most ${String(MAX_BULK_RECIPIENTS)} recipients (got ${String(recipients.length)}).`,
      );
    }

    const template = await authorizeBroadcast({
      templateId,
      recipients,
      guards: {
        loadTemplate: async (id) => {
          const snap = await db.collection(COLLECTIONS.emailTemplates).doc(id).get();
          return snap.exists ? (snap.data() as EmailTemplate) : null;
        },
        rosterLookup: firestoreStaffRosterLookup(db),
        // Per-caller rate limit on the broadcast *operation* itself (not per
        // recipient) — the non-negotiable throttle for an otherwise-
        // unrestricted mass-mail callable. The counter only increments on an
        // allowed request.
        chargeRateLimit: async () => {
          const limits = await loadRateLimits(db);
          const max = limits.manualEmailBroadcastsPerHour;
          const decision = await checkRateLimit(db, {
            userEmail: callerEmail,
            key: RATE_LIMIT_KEYS.manualEmailBroadcast,
            max,
            windowMs: HOUR_MS,
          });
          return { allowed: decision.allowed, max };
        },
      },
    });

    const appSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
    const appData = appSnap.data() as
      | { branding?: { appName?: string }; signupLink?: string }
      | undefined;
    const appName = appData?.branding?.appName ?? 'Orono Peer Observations';
    const signupLink = appData?.signupLink ?? '';

    const fullVars: Record<string, string> = {
      appName,
      signupLink,
      signInLink: 'https://observations.orono.k12.mn.us',
      ...vars,
    };

    // Subject/body are the same for every recipient in a broadcast (no
    // per-recipient personalization), so substitute once rather than per
    // iteration.
    const subject = substituteVariables(template.subject, fullVars);
    const html = substituteVariables(template.bodyHtml, fullVars);

    // Unique per invocation — an auto-id from the /mail collection, which costs
    // no round trip and never collides with another broadcast's ids.
    const broadcastId = db.collection(COLLECTIONS.mail).doc().id;

    const { sent, suppressed } = await queueBroadcast({
      recipients,
      templateId,
      broadcastId,
      send: ({ to, mailDocId }) =>
        sendEmail({
          db,
          to,
          subject,
          html,
          mailDocId,
          triggerType: 'manual',
          auditDetails: {
            templateId,
            toEmail: to,
            callerEmail,
            triggerType: 'manual',
            broadcast: true,
            broadcastId,
          },
        }),
    });

    return { requested: recipients.length, sent, suppressed } satisfies SendBulkManualEmailResult;
  },
);
