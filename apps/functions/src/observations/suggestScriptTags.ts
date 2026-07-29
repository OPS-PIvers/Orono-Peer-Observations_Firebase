import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { RubricComponent } from '@ops/shared';
import {
  assertScriptAutoTagEnabled,
  filterVerbatimSuggestions,
  loadScriptAutoTagFeature,
  loadTaggingContext,
  type ScriptTagSuggestion,
} from './scriptTagging.js';

if (getApps().length === 0) initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface SuggestScriptTagsRequest {
  observationId?: string;
}

/** A suggestion enriched with everything the review dialog needs to render it. */
export interface ReviewableScriptTagSuggestion extends ScriptTagSuggestion {
  componentTitle: string;
  /** Full text of the paragraph the span was found in, for context. */
  paragraphText: string;
}

interface SuggestScriptTagsResponse {
  suggestions: ReviewableScriptTagSuggestion[];
  /** bg/fg for every component that appears in `suggestions`. */
  componentColors: { componentId: string; bg: string; fg: string }[];
  /** Suggestions Gemini returned that we dropped as unmatchable. */
  skippedCount: number;
}

/**
 * Step 1 of the two-step auto-tag flow: ask Gemini which spans of the script
 * demonstrate evidence of each rubric component, keep only the ones that are
 * verbatim substrings of the script, and hand them back for the observer to
 * review. **This callable writes nothing** — the observation is untouched
 * until the observer approves a subset and `applyScriptTags` runs.
 *
 * Gemini never paraphrases or rewrites: it only points at substrings the
 * observer typed. Suggestions whose `text` can't be located verbatim are
 * dropped here (counted as `skippedCount`).
 */
export const suggestScriptTags = onCall(
  {
    region: 'us-central1',
    secrets: [GEMINI_API_KEY],
    memory: '512MiB',
    timeoutSeconds: 120,
    // maxInstances caps concurrent Gemini-tagging work to bound cost/abuse
    // exposure — not copied from onObservationWritten's maxInstances: 1, which
    // exists there solely to respect the Sheets API's 60-writes/min quota.
    // The ceiling lives on this half of the flow (inherited from the retired
    // geminiTagScript) because the Gemini round-trip is the expensive part;
    // applyScriptTags is a plain Firestore write and must not consume it.
    maxInstances: 10,
  },
  async (request): Promise<SuggestScriptTagsResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId } = (request.data ?? {}) as SuggestScriptTagsRequest;
    if (!observationId) {
      throw new HttpsError('invalid-argument', 'observationId required');
    }

    const db = getFirestore();
    const feature = await loadScriptAutoTagFeature(db);
    assertScriptAutoTagEnabled(feature);

    const callerRole = request.auth.token['role'] as string | undefined;
    const ctx = await loadTaggingContext(db, observationId, userEmail, callerRole);

    const raw = await callGeminiForTags(
      ctx.activeComponents,
      ctx.paragraphs,
      GEMINI_API_KEY.value(),
      feature.model,
    );

    const validIds = new Set(ctx.activeComponents.map((c) => c.id));
    const { accepted, rejected } = filterVerbatimSuggestions(raw, ctx.paragraphs, validIds);

    const titleById = new Map(ctx.activeComponents.map((c) => [c.id, c.title]));
    const suggestions: ReviewableScriptTagSuggestion[] = accepted.map((s) => ({
      ...s,
      componentTitle: titleById.get(s.componentId) ?? s.componentId,
      paragraphText: ctx.paragraphs[s.paragraphIndex] ?? '',
    }));

    const suggestedIds = new Set(suggestions.map((s) => s.componentId));
    const componentColors: { componentId: string; bg: string; fg: string }[] = [];
    for (const componentId of suggestedIds) {
      const color = ctx.componentColorMap.get(componentId);
      if (color) componentColors.push({ componentId, bg: color.bg, fg: color.fg });
    }

    logger.info('suggestScriptTags: proposed spans', {
      observationId,
      suggested: suggestions.length,
      skipped: rejected.length,
    });
    return { suggestions, componentColors, skippedCount: rejected.length };
  },
);

// ─── Gemini call ─────────────────────────────────────────────────────────────

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

async function callGeminiForTags(
  components: readonly RubricComponent[],
  paragraphs: readonly string[],
  apiKey: string,
  model: string,
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
${JSON.stringify(paragraphBlock, null, 2)}`;

  const url = `${GEMINI_BASE}/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new HttpsError(
      'internal',
      `Gemini API error ${String(response.status)}: ${text.slice(0, 300)}`,
    );
  }
  const data = (await response.json()) as GeminiResponse;
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new HttpsError('internal', 'Gemini returned no content');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error('suggestScriptTags: invalid JSON from Gemini', { raw: raw.slice(0, 500) });
    throw new HttpsError('internal', 'Gemini returned invalid JSON');
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
