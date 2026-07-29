import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  isAdminRole,
  isSpecialRole,
  type EmailTemplate,
} from '@ops/shared';
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

/**
 * Callable for PEs and admins to broadcast a manual-trigger template to a
 * filtered group of staff in one action — the "Message a group" action in the
 * Staff admin area (apps/web/src/admin/staff). Mirrors sendManualEmail.ts's
 * auth check, template-load, and validation exactly (see PLAT-08), then loops
 * the per-recipient send so each recipient keeps their own mailDocId (the
 * same `manual-${templateId}-${local}-${Date.now()}` convention) and their
 * own preference-suppression check — both already handled inside sendEmail().
 *
 * Unrestricted callers (any PE or admin, not just admins — see the owner
 * decision this implements) is the reason for the two non-negotiable
 * safeguards here: MAX_BULK_RECIPIENTS hard-caps a single broadcast, and a
 * configurable per-caller rate limit (rateLimits.manualEmailBroadcastsPerHour)
 * throttles how often any one caller can trigger a broadcast at all.
 */
export const sendBulkManualEmail = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerRole = request.auth.token['role'] as string | undefined;
    const hasSpecialAccess = isSpecialRole(callerRole ?? null) || isAdminRole(callerRole ?? null);
    if (!hasSpecialAccess) {
      throw new HttpsError('permission-denied', 'Only PEs and admins can send manual emails');
    }
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

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

    const db = getFirestore();

    // Per-caller rate limit on the broadcast *operation* itself (not per
    // recipient) — the non-negotiable throttle for an otherwise-unrestricted
    // mass-mail callable. The counter only increments on an allowed request.
    const limits = await loadRateLimits(db);
    const decision = await checkRateLimit(db, {
      userEmail: callerEmail,
      key: RATE_LIMIT_KEYS.manualEmailBroadcast,
      max: limits.manualEmailBroadcastsPerHour,
      windowMs: HOUR_MS,
    });
    if (!decision.allowed) {
      throw new HttpsError(
        'resource-exhausted',
        `Broadcast limit reached (${String(limits.manualEmailBroadcastsPerHour)}/hour). Try again later.`,
      );
    }

    const templateSnap = await db.collection(COLLECTIONS.emailTemplates).doc(templateId).get();
    if (!templateSnap.exists) throw new HttpsError('not-found', 'Template not found');

    const template = templateSnap.data() as EmailTemplate;
    if (!template.isActive) throw new HttpsError('failed-precondition', 'Template is inactive');
    if (template.triggerType !== 'manual') {
      throw new HttpsError('invalid-argument', 'Only manual templates can be sent this way');
    }

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

    const results = await Promise.all(
      recipients.map((toEmail) => {
        const mailDocId = `manual-${templateId}-${toEmail.split('@')[0]}-${String(Date.now())}`;
        return sendEmail({
          db,
          to: toEmail,
          subject,
          html,
          mailDocId,
          triggerType: 'manual',
          auditDetails: {
            templateId,
            toEmail,
            callerEmail,
            triggerType: 'manual',
            broadcast: true,
          },
        });
      }),
    );

    const suppressed = recipients.filter((_, i) => !results[i]?.queued);
    const sent = results.filter((r) => r.queued).length;

    return { requested: recipients.length, sent, suppressed } satisfies SendBulkManualEmailResult;
  },
);
