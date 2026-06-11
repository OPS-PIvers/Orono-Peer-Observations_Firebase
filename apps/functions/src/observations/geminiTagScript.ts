import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DEFAULT_GEMINI_MODEL,
  isAdminRole,
  OBSERVATION_STATUS,
  roleYearMappingDocId,
  tiptapDoc,
  type ComponentColor,
  type Observation,
  type ObservationStatus,
  type RoleYearMapping,
  type Rubric,
  type RubricComponent,
  type TiptapDoc,
} from '@ops/shared';
import {
  applyTagsToScriptDoc,
  extractParagraphs,
  type RawTagSuggestion,
} from './scriptTextblocks.js';
import { resolveRole } from './roleLookup.js';

if (getApps().length === 0) initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiTagRequest {
  observationId?: string;
  /** The editor's current (possibly not-yet-autosaved) script doc. */
  scriptDoc?: unknown;
}

export interface GeminiTagResponse {
  taggedCount: number;
  skippedCount: number;
  /**
   * The tagged doc. Returned so the open editor — which hydrates its local
   * draft only once per observation — can replace its content with the
   * tagged version; otherwise the next autosave flush would write the stale
   * untagged local doc back over the tags.
   */
  scriptDoc: TiptapDoc;
}

/**
 * Callable function that asks Gemini to identify spans in the script that
 * demonstrate evidence of each rubric component, then applies
 * `componentTag` marks to the matching text. It tags the `scriptDoc` sent by
 * the caller when provided (the open editor's current content), falling back
 * to `observation.scriptDoc`, persists the tagged doc, and returns it so the
 * editor can replace its local draft with the tagged version.
 *
 * The function never paraphrases or rewrites — it only finds verbatim
 * substrings of paragraphs the observer typed and marks them. Tags whose
 * `text` cannot be located verbatim are dropped (counted as `skipped`).
 */
export const geminiTagScript = onCall(
  {
    region: 'us-central1',
    secrets: [GEMINI_API_KEY],
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (request): Promise<GeminiTagResponse> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const { observationId, scriptDoc: rawScriptDoc } = (request.data ?? {}) as GeminiTagRequest;
    if (!observationId) {
      throw new HttpsError('invalid-argument', 'observationId required');
    }

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) throw new HttpsError('not-found', 'Observation not found');
    const obs = { id: obsSnap.id, ...obsSnap.data() } as unknown as Observation & { id: string };

    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);
    if (!isAdmin && obs.observerEmail !== userEmail) {
      throw new HttpsError('permission-denied', 'Only the observer or an admin can auto-tag.');
    }
    assertDraftForAutoTag(obs.status);

    const settingsSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
    // Raw Firestore reads don't apply Zod defaults; partial-shape the tree.
    const settings = settingsSnap.exists
      ? (settingsSnap.data() as {
          gemini?: { scriptAutoTag?: { enabled?: boolean; model?: string } };
        })
      : null;
    if (settings?.gemini?.scriptAutoTag?.enabled === false) {
      throw new HttpsError(
        'failed-precondition',
        'Script auto-tagging is currently disabled by an admin.',
      );
    }
    const configuredModel = settings?.gemini?.scriptAutoTag?.model;
    const model =
      configuredModel && configuredModel.length > 0 ? configuredModel : DEFAULT_GEMINI_MODEL;

    // Prefer the editor's current content over the Firestore copy — the open
    // editor may be ahead of the last autosave flush, and tags must land on
    // exactly what the observer is looking at.
    let clientDoc: TiptapDoc | undefined;
    if (rawScriptDoc !== undefined) {
      const parsed = tiptapDoc.safeParse(rawScriptDoc);
      if (!parsed.success) {
        throw new HttpsError('invalid-argument', 'scriptDoc must be a Tiptap document');
      }
      clientDoc = parsed.data;
    }
    const scriptDoc = clientDoc ?? obs.scriptDoc;
    if (!scriptDoc) {
      throw new HttpsError('failed-precondition', 'Script is empty — nothing to tag.');
    }
    const paragraphs = extractParagraphs(scriptDoc);
    if (paragraphs.every((p) => p.trim().length === 0)) {
      throw new HttpsError('failed-precondition', 'Script is empty — nothing to tag.');
    }

    const role = await resolveRole(db, obs.observedRole);
    if (!role) throw new HttpsError('failed-precondition', `Role "${obs.observedRole}" missing.`);

    const rubricSnap = await db.doc(`${COLLECTIONS.rubrics}/${role.rubricId}`).get();
    if (!rubricSnap.exists) {
      throw new HttpsError('failed-precondition', `Rubric "${role.rubricId}" missing.`);
    }
    const rubric = rubricSnap.data() as Rubric;

    const mappingDocId = roleYearMappingDocId(role.roleId, obs.observedYear);
    const mappingSnap = await db.doc(`${COLLECTIONS.roleYearMappings}/${mappingDocId}`).get();
    const mapping = mappingSnap.exists ? (mappingSnap.data() as RoleYearMapping) : null;
    const allowSet = mapping ? new Set(mapping.assignedComponentIds) : null;

    const activeComponents: RubricComponent[] = [];
    for (const d of rubric.domains) {
      for (const c of d.components) {
        if (!allowSet || allowSet.has(c.id)) activeComponents.push(c);
      }
    }
    if (activeComponents.length === 0) {
      throw new HttpsError('failed-precondition', 'No components are assigned for this role/year.');
    }

    const componentColorMap = new Map<string, ComponentColor>();
    for (const c of activeComponents) componentColorMap.set(c.id, colorFor(c));

    const suggestions = await callGeminiForTags(
      activeComponents,
      paragraphs,
      GEMINI_API_KEY.value(),
      model,
    );

    const validIds = new Set(activeComponents.map((c) => c.id));
    const result = buildAutoTagResult(
      scriptDoc,
      paragraphs,
      suggestions,
      validIds,
      componentColorMap,
    );

    await obsRef.update({
      scriptDoc: result.scriptDoc,
      lastModifiedAt: FieldValue.serverTimestamp(),
    });

    logger.info('geminiTagScript: tagged spans', {
      observationId,
      tagged: result.taggedCount,
      skipped: result.skippedCount,
    });
    return result;
  },
);

/**
 * Finalized observations are immutable through every server entry point.
 * The Admin SDK bypasses the Firestore rules that lock Finalized docs, so the
 * callable must enforce the Draft-only invariant itself (mirroring uploadAudio
 * and uploadEvidenceFile). Exported for unit tests.
 */
export function assertDraftForAutoTag(status: ObservationStatus): void {
  if (status !== OBSERVATION_STATUS.draft) {
    throw new HttpsError('failed-precondition', 'Cannot auto-tag a finalized observation.');
  }
}

/**
 * Pure core of the tagging step, exported for unit tests: drop suggestions
 * that reference unknown components or text that isn't a verbatim substring
 * of the indexed paragraph, apply the survivors as `componentTag` marks, and
 * shape the callable response (counts + the tagged doc the editor re-hydrates
 * its local draft from).
 */
export function buildAutoTagResult(
  scriptDoc: TiptapDoc,
  paragraphs: string[],
  suggestions: RawTagSuggestion[],
  validComponentIds: ReadonlySet<string>,
  componentColorMap: Map<string, ComponentColor>,
): GeminiTagResponse {
  let skippedCount = 0;
  const accepted: RawTagSuggestion[] = [];
  for (const s of suggestions) {
    if (!validComponentIds.has(s.componentId)) {
      skippedCount += 1;
      continue;
    }
    const para = paragraphs[s.paragraphIndex];
    if (!para || !para.includes(s.text) || s.text.trim().length === 0) {
      skippedCount += 1;
      continue;
    }
    accepted.push(s);
  }
  return {
    taggedCount: accepted.length,
    skippedCount,
    scriptDoc: applyTagsToScriptDoc(scriptDoc, accepted, componentColorMap),
  };
}

// ─── Gemini call ─────────────────────────────────────────────────────────────

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

async function callGeminiForTags(
  components: RubricComponent[],
  paragraphs: string[],
  apiKey: string,
  model: string,
): Promise<RawTagSuggestion[]> {
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

  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    logger.error('geminiTagScript: invalid JSON from Gemini', { raw: raw.slice(0, 500) });
    throw new HttpsError('internal', 'Gemini returned invalid JSON');
  }

  const tags = (parsed as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return [];
  const out: RawTagSuggestion[] = [];
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

// ─── Color helper (mirror of apps/web/src/observations/component-colors.ts) ──

const DEFAULT_COLOR: ComponentColor = { bg: '#eaecf5', fg: '#1d2a5d' };
const FALLBACK_PALETTE: readonly ComponentColor[] = [
  { bg: '#dbeafe', fg: '#1e3a8a' },
  { bg: '#fef3c7', fg: '#78350f' },
  { bg: '#dcfce7', fg: '#14532d' },
  { bg: '#fce7f3', fg: '#831843' },
  { bg: '#ede9fe', fg: '#4c1d95' },
  { bg: '#ffedd5', fg: '#7c2d12' },
  { bg: '#cffafe', fg: '#164e63' },
  { bg: '#fee2e2', fg: '#7f1d1d' },
  { bg: '#e0e7ff', fg: '#312e81' },
  { bg: '#f3e8ff', fg: '#581c87' },
  { bg: '#ccfbf1', fg: '#134e4a' },
  { bg: '#fef9c3', fg: '#713f12' },
];

function hashStringToInt(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorFor(component: RubricComponent): ComponentColor {
  if (component.color) return component.color;
  const idx = hashStringToInt(component.id) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx] ?? DEFAULT_COLOR;
}
