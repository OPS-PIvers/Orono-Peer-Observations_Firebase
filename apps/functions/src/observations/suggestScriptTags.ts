import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ANTHROPIC_API_KEY, generateText, loadFeatureModel } from '../lib/aiClient.js';
import type { AiModel, RubricComponent } from '@ops/shared';
import {
  assertScriptAutoTagAvailable,
  filterVerbatimSuggestions,
  loadScriptAutoTagFeature,
  loadTaggingContext,
  parseTagScope,
  type ScriptTagSuggestion,
  type TagScope,
} from './scriptTagging.js';
import {
  hasCompletedRun,
  isClaimActive,
  latestRunRef,
  markStaleSuggestions,
  parseRerunReason,
  rerunPromptContext,
  type StoredScriptTagRun,
  type SuggestionStatus,
} from './scriptTagRun.js';

if (getApps().length === 0) initializeApp();

interface SuggestScriptTagsRequest {
  observationId?: string;
  /** `'full'` to tag against the whole rubric; defaults to assigned only. */
  scope?: unknown;
  /**
   * Required to run the AI again once a result exists: what changed, or what
   * the model should know this time. Without it the last result is returned.
   */
  reason?: unknown;
}

/** A suggestion enriched with everything the review dialog needs to render it. */
export interface ReviewableScriptTagSuggestion extends ScriptTagSuggestion {
  componentTitle: string;
  /** Full text of the paragraph the span was found in, for context. */
  paragraphText: string;
  status: SuggestionStatus;
}

interface SuggestScriptTagsResponse {
  suggestions: ReviewableScriptTagSuggestion[];
  /** bg/fg for every component that appears in `suggestions`. */
  componentColors: { componentId: string; bg: string; fg: string }[];
  /** Suggestions the model returned that we dropped as unmatchable. */
  skippedCount: number;
  run: {
    /** True when this is the saved result of an earlier run, not a new AI call. */
    reused: boolean;
    scope: TagScope;
    createdAt: string | null;
    createdBy: string;
    runCount: number;
    reason: string | null;
  };
}

/**
 * Step 1 of the two-step auto-tag flow: ask the AI model which spans of the
 * script demonstrate evidence of each rubric component, keep only the ones
 * that are verbatim substrings of the script, and hand them back for the
 * observer to review. The observation itself is untouched until the observer
 * approves a subset and `applyScriptTags` runs.
 *
 * Each observation gets one AI run per click-through, not one per click: the
 * result is saved (see scriptTagRun.ts), and a call without a `reason` after
 * that returns the saved result instead of calling the model again. Running
 * it again requires the observer to say why, and that reason goes to the
 * model as extra context. An in-flight claim stops double clicks and a second
 * tab from starting parallel runs.
 *
 * The model never paraphrases or rewrites: it only points at substrings the
 * observer typed. Suggestions whose `text` can't be located verbatim are
 * dropped here (counted as `skippedCount`).
 */
export const suggestScriptTags = onCall(
  {
    // Demo-edit sessions allowed; confined to demo staff below.
    allowDemoEdit: true,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
    // maxInstances caps concurrent Gemini-tagging work to bound cost/abuse
    // exposure — not copied from onObservationWritten's maxInstances: 1, which
    // exists there solely to respect the Sheets API's 60-writes/min quota.
    // The ceiling lives on this half of the flow (inherited from the retired
    // geminiTagScript) because the Gemini round-trip is the expensive part;
    // applyScriptTags is a plain Firestore write and must not consume it.
    maxInstances: 10,
    // Needed only when an admin routes auto-tag to a Claude model.
    secrets: [ANTHROPIC_API_KEY],
  },
  async (request): Promise<SuggestScriptTagsResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const {
      observationId,
      scope: rawScope,
      reason: rawReason,
    } = (request.data ?? {}) as SuggestScriptTagsRequest;
    if (!observationId) {
      throw new HttpsError('invalid-argument', 'observationId required');
    }
    const reason = parseRerunReason(rawReason);

    const db = getFirestore();
    const feature = await loadScriptAutoTagFeature(db);
    assertScriptAutoTagAvailable(feature, userEmail);

    const runRef = latestRunRef(db, observationId);
    const previous = (await runRef.get()).data() as Partial<StoredScriptTagRun> | undefined;
    const reuse = reason === null && hasCompletedRun(previous);
    // Reopening shows the saved run under the scope it was made with, so
    // Apply validates against the same component set.
    const scope = reuse && previous?.scope ? previous.scope : parseTagScope(rawScope);

    const callerRole = request.auth.token['role'] as string | undefined;
    // Runs before the reuse branch too: reopening a saved result needs the
    // same access and draft checks as making one.
    const ctx = await loadTaggingContext(
      db,
      observationId,
      userEmail,
      callerRole,
      request.auth,
      scope,
    );

    if (reuse && previous) {
      logger.info('suggestScriptTags: reopened saved run', { observationId });
      return {
        suggestions: markStaleSuggestions(
          previous.suggestions ?? [],
          ctx.paragraphs,
          ctx.validComponentIds,
        ),
        componentColors: previous.componentColors ?? [],
        skippedCount: previous.skippedCount ?? 0,
        run: {
          reused: true,
          scope,
          createdAt: toIso(previous.createdAt),
          createdBy: previous.createdBy ?? '',
          runCount: previous.runCount ?? 1,
          reason: previous.reason ?? null,
        },
      };
    }

    // Claim the run. Re-reads inside the transaction so two clicks that both
    // got past the read above can't both reach the model.
    const priorRunCount = await db.runTransaction(async (tx) => {
      const snap = await tx.get(runRef);
      const data = snap.data() as Partial<StoredScriptTagRun> | undefined;
      if (isClaimActive(data, Date.now())) {
        throw new HttpsError(
          'failed-precondition',
          'Auto-tag is already running for this observation. Wait for it to finish.',
        );
      }
      if (reason === null && hasCompletedRun(data)) {
        throw new HttpsError(
          'failed-precondition',
          'Auto-tag already ran for this observation. Click Auto-tag again to review the result.',
        );
      }
      tx.set(runRef, { inFlight: { by: userEmail, startedAtMs: Date.now() } }, { merge: true });
      return data?.runCount ?? 0;
    });

    try {
      const model = await loadFeatureModel(db, 'scriptAutoTag');
      const extraContext =
        reason === null ? '' : rerunPromptContext(reason, previous?.suggestions ?? []);
      const raw = await callModelForTags(
        ctx.activeComponents,
        ctx.paragraphs,
        model,
        { userEmail, observationId },
        extraContext,
      );

      const { accepted, rejected } = filterVerbatimSuggestions(
        raw,
        ctx.paragraphs,
        ctx.validComponentIds,
      );

      const titleById = new Map(ctx.activeComponents.map((c) => [c.id, c.title]));
      const suggestions: ReviewableScriptTagSuggestion[] = accepted.map((s) => ({
        ...s,
        componentTitle: titleById.get(s.componentId) ?? s.componentId,
        paragraphText: ctx.paragraphs[s.paragraphIndex] ?? '',
        status: 'pending',
      }));

      const suggestedIds = new Set(suggestions.map((s) => s.componentId));
      const componentColors: { componentId: string; bg: string; fg: string }[] = [];
      for (const componentId of suggestedIds) {
        const color = ctx.componentColorMap.get(componentId);
        if (color) componentColors.push({ componentId, bg: color.bg, fg: color.fg });
      }

      const createdAt = new Date();
      const stored: StoredScriptTagRun = {
        scope,
        suggestions,
        componentColors,
        skippedCount: rejected.length,
        createdAt,
        createdBy: userEmail,
        modelId: model.id,
        runCount: priorRunCount + 1,
        reason,
        inFlight: null,
      };
      await runRef.set(stored);

      logger.info('suggestScriptTags: proposed spans', {
        observationId,
        suggested: suggestions.length,
        skipped: rejected.length,
        runCount: stored.runCount,
        rerun: reason !== null,
      });
      return {
        suggestions,
        componentColors,
        skippedCount: rejected.length,
        run: {
          reused: false,
          scope,
          createdAt: createdAt.toISOString(),
          createdBy: userEmail,
          runCount: stored.runCount,
          reason,
        },
      };
    } catch (err) {
      // Release the claim so a failed call doesn't block a retry until the
      // TTL runs out. The saved earlier result (if any) is left as it was.
      await runRef.set({ inFlight: null }, { merge: true }).catch((clearErr: unknown) => {
        logger.error('suggestScriptTags: failed to clear run claim after error', clearErr);
      });
      throw err;
    }
  },
);

/** Firestore hands back a Timestamp; a freshly built run holds a Date. */
function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

// ─── Model call ──────────────────────────────────────────────────────────────

const TAGS_SCHEMA = {
  type: 'object',
  properties: {
    tags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          paragraphIndex: { type: 'integer' },
          text: { type: 'string' },
          componentId: { type: 'string' },
        },
        required: ['paragraphIndex', 'text', 'componentId'],
        additionalProperties: false,
      },
    },
  },
  required: ['tags'],
  additionalProperties: false,
};

async function callModelForTags(
  components: readonly RubricComponent[],
  paragraphs: readonly string[],
  model: AiModel,
  caller: { userEmail: string; observationId: string },
  extraContext = '',
): Promise<ScriptTagSuggestion[]> {
  const componentBlock = components.map((c) => ({
    id: c.id,
    title: c.title,
    proficiencyDescriptors: c.proficiencyLevels,
    lookFors: c.lookFors.map((lf) => lf.text),
  }));

  const paragraphBlock = paragraphs.map((text, i) => ({ paragraphIndex: i, text }));

  const prompt = `You are tagging a teacher observation script with components from the Danielson Framework. For each paragraph, identify spans of text — verbatim substrings of that paragraph — that demonstrate evidence of any listed component.

RULES:
- "text" MUST be an exact verbatim substring of the paragraph at "paragraphIndex". Do not paraphrase, summarize, or correct.
- Only tag spans that show clear evidence; skip ambiguous text.
- A paragraph may produce zero, one, or many tags.
- Use the component "id" exactly as listed.
- Output strict JSON matching: { "tags": [ { "paragraphIndex": number, "text": string, "componentId": string } ] }
- No prose, no markdown, no explanation outside the JSON.

COMPONENTS:
${JSON.stringify(componentBlock, null, 2)}

SCRIPT:
${JSON.stringify(paragraphBlock, null, 2)}${extraContext}`;

  const raw = await generateText(
    model,
    { prompt, jsonSchema: TAGS_SCHEMA, temperature: 0.2 },
    { feature: 'scriptAutoTag', logContext: 'suggestScriptTags', ...caller },
  );
  if (!raw) throw new HttpsError('internal', 'The AI model returned no content');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error('suggestScriptTags: invalid JSON from model', {
      model: model.id,
      raw: raw.slice(0, 500),
    });
    throw new HttpsError('internal', 'The AI model returned invalid JSON');
  }

  const tags = (parsed as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return [];
  const out: ScriptTagSuggestion[] = [];
  for (const t of tags) {
    if (!t || typeof t !== 'object') continue;
    const tt = t as { paragraphIndex?: unknown; text?: unknown; componentId?: unknown };
    if (
      typeof tt.paragraphIndex === 'number' &&
      typeof tt.text === 'string' &&
      typeof tt.componentId === 'string'
    ) {
      out.push({
        paragraphIndex: tt.paragraphIndex,
        text: tt.text,
        componentId: tt.componentId,
      });
    }
  }
  return out;
}
