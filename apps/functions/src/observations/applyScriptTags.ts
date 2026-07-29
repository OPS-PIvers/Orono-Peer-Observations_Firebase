import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Observation, TiptapDoc } from '@ops/shared';
import {
  applyTagsToScriptDoc,
  assertObservationTaggable,
  assertScriptAutoTagEnabled,
  extractParagraphs,
  filterVerbatimSuggestions,
  loadScriptAutoTagFeature,
  loadTaggingContext,
  resolveActiveComponents,
  transactionReader,
  type ScriptTagSuggestion,
} from './scriptTagging.js';

if (getApps().length === 0) initializeApp();

/**
 * Upper bound on how many suggestions one apply call may carry. `suggestScriptTags`
 * is naturally capped by paragraph count, so this only exists to stop a
 * hand-crafted request from making the doc walk unbounded.
 */
const MAX_SUGGESTIONS = 500;

interface ApplyScriptTagsRequest {
  observationId?: string;
  suggestions?: unknown;
}

interface ApplyScriptTagsResponse {
  appliedCount: number;
  /** Approved suggestions that no longer matched the script and were dropped. */
  rejectedCount: number;
  /** The resulting script, so the open editor can adopt it without a reload. */
  scriptDoc: TiptapDoc;
}

/**
 * Step 2 of the two-step auto-tag flow: write `componentTag` marks for the
 * subset of suggestions the observer approved in the review dialog.
 *
 * Suggestions are NOT persisted between the two steps — the client passes the
 * approved subset straight back — so this function treats them as untrusted
 * input and re-runs the same verbatim match `suggestScriptTags` ran, against
 * the script as it exists *at write time*, inside a transaction. A review
 * dialog left open while the observer kept editing therefore cannot smear
 * stale spans across text they no longer describe: the non-matching ones are
 * counted in `rejectedCount` and dropped.
 *
 * The transaction re-establishes *every* invariant from its own reads rather
 * than trusting the pre-transaction one: that the observation is still an
 * editable draft, that the caller still owns it, and that each `componentId`
 * is still assigned to this role/year. All of those can change while the
 * review dialog sits open, so anything the pre-transaction read learned is a
 * fail-fast courtesy, never a permission to write.
 *
 * No `maxInstances` ceiling here on purpose: this is a plain Firestore write
 * with no Gemini call, and it must not consume the AI concurrency budget that
 * `suggestScriptTags` reserves.
 */
export const applyScriptTags = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request): Promise<ApplyScriptTagsResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId, suggestions: rawSuggestions } = (request.data ??
      {}) as ApplyScriptTagsRequest;
    if (!observationId) {
      throw new HttpsError('invalid-argument', 'observationId required');
    }
    const submitted = parseSuggestions(rawSuggestions);

    const db = getFirestore();
    const feature = await loadScriptAutoTagFeature(db);
    assertScriptAutoTagEnabled(feature);

    const callerRole = request.auth.token['role'] as string | undefined;
    // Fail fast on a cheap non-transactional read. This is a courtesy check
    // only — nothing it learns is trusted at write time. The transaction below
    // re-establishes every invariant from its own reads.
    const ctx = await loadTaggingContext(db, observationId, userEmail, callerRole);

    const result = await db.runTransaction(async (tx): Promise<ApplyScriptTagsResponse> => {
      // ── Reads first. Firestore rejects any read that follows a write in the
      // same transaction, so every re-validation below must happen up here.
      const snap = await tx.get(ctx.obsRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Observation not found');
      const obs = snap.data() as unknown as Observation;

      // Re-check permission and draft status against the transaction's own
      // read: the observation may have been finalized while the review dialog
      // sat open, and a finalized record is locked to AI edits just as firmly
      // as it is to hand edits.
      assertObservationTaggable(obs, userEmail, callerRole);

      const currentDoc: TiptapDoc | undefined = obs.scriptDoc;
      if (!currentDoc) {
        throw new HttpsError('failed-precondition', 'Script is empty — nothing to tag.');
      }

      // Re-derive the assignable components too. A rubric edit or a role/year
      // assignment change between suggest and apply must not let a stale
      // componentId through the verbatim safety net.
      const { componentColorMap, validComponentIds } = await resolveActiveComponents(
        db,
        transactionReader(tx),
        obs,
      );

      const paragraphs = extractParagraphs(currentDoc);
      const { accepted, rejected } = filterVerbatimSuggestions(
        submitted,
        paragraphs,
        validComponentIds,
      );
      if (accepted.length === 0) {
        // Every approved span went stale — leave the script exactly as it is.
        return { appliedCount: 0, rejectedCount: rejected.length, scriptDoc: currentDoc };
      }

      // ── Write. No reads past this point.
      const newDoc = applyTagsToScriptDoc(currentDoc, accepted, componentColorMap);
      tx.update(ctx.obsRef, {
        scriptDoc: newDoc,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
      return {
        appliedCount: accepted.length,
        rejectedCount: rejected.length,
        scriptDoc: newDoc,
      };
    });

    logger.info('applyScriptTags: wrote approved spans', {
      observationId,
      submitted: submitted.length,
      applied: result.appliedCount,
      rejected: result.rejectedCount,
    });
    return result;
  },
);

/**
 * Validate the client-supplied suggestion list. Anything malformed is a bug or
 * a hand-crafted request, not a stale review dialog, so it fails loudly rather
 * than being silently filtered — staleness is handled later by the verbatim
 * re-check, which is a normal outcome with its own count.
 */
function parseSuggestions(raw: unknown): ScriptTagSuggestion[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpsError('invalid-argument', 'suggestions must be a non-empty array');
  }
  if (raw.length > MAX_SUGGESTIONS) {
    throw new HttpsError(
      'invalid-argument',
      `Too many suggestions (max ${String(MAX_SUGGESTIONS)})`,
    );
  }
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpsError('invalid-argument', 'Each suggestion must be an object');
    }
    const s = entry as { paragraphIndex?: unknown; text?: unknown; componentId?: unknown };
    if (!Number.isInteger(s.paragraphIndex) || (s.paragraphIndex as number) < 0) {
      throw new HttpsError('invalid-argument', 'paragraphIndex must be a non-negative integer');
    }
    if (typeof s.text !== 'string' || s.text.length === 0) {
      throw new HttpsError('invalid-argument', 'text must be a non-empty string');
    }
    if (typeof s.componentId !== 'string' || s.componentId.length === 0) {
      throw new HttpsError('invalid-argument', 'componentId must be a non-empty string');
    }
    // Drop any extra fields the review dialog carried (componentTitle,
    // paragraphText) — only the three load-bearing ones reach the doc walk.
    return {
      paragraphIndex: s.paragraphIndex as number,
      text: s.text,
      componentId: s.componentId,
    };
  });
}
