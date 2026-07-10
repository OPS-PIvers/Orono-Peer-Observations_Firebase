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
  roleYearMappingDocId,
  type ComponentColor,
  type Observation,
  type Role,
  type RoleYearMapping,
  type Rubric,
  type RubricComponent,
  type TiptapDoc,
} from '@ops/shared';

if (getApps().length === 0) initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiTagRequest {
  observationId?: string;
}

interface GeminiTagResponse {
  taggedCount: number;
  skippedCount: number;
}

interface RawTagSuggestion {
  paragraphIndex: number;
  text: string;
  componentId: string;
}

/**
 * Callable function that asks Gemini to identify spans in the script that
 * demonstrate evidence of each rubric component, then applies
 * `componentTag` marks to the matching text in `observation.scriptDoc`.
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

    const { observationId } = (request.data ?? {}) as GeminiTagRequest;
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

    const scriptDoc = obs.scriptDoc;
    if (!scriptDoc) {
      throw new HttpsError('failed-precondition', 'Script is empty — nothing to tag.');
    }
    const paragraphs = extractParagraphs(scriptDoc);
    if (paragraphs.every((p) => p.trim().length === 0)) {
      throw new HttpsError('failed-precondition', 'Script is empty — nothing to tag.');
    }

    const roleByIdSnap = await db
      .collection(COLLECTIONS.roles)
      .where('roleId', '==', obs.observedRole)
      .limit(1)
      .get();
    const roleByNameSnap = roleByIdSnap.empty
      ? await db
          .collection(COLLECTIONS.roles)
          .where('displayName', '==', obs.observedRole)
          .limit(1)
          .get()
      : null;
    const roleDoc = !roleByIdSnap.empty ? roleByIdSnap.docs[0] : roleByNameSnap?.docs[0];
    if (!roleDoc)
      throw new HttpsError('failed-precondition', `Role "${obs.observedRole}" missing.`);
    const role = roleDoc.data() as Role;

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
    let skippedCount = 0;
    const accepted: RawTagSuggestion[] = [];
    for (const s of suggestions) {
      if (!validIds.has(s.componentId)) {
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

    const newDoc = applyTagsToScriptDoc(scriptDoc, accepted, componentColorMap);

    await obsRef.update({
      scriptDoc: newDoc,
      lastModifiedAt: FieldValue.serverTimestamp(),
    });

    logger.info('geminiTagScript: tagged spans', {
      observationId,
      tagged: accepted.length,
      skipped: skippedCount,
    });
    return { taggedCount: accepted.length, skippedCount };
  },
);

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

// ─── Tiptap doc walking ──────────────────────────────────────────────────────

interface MaybeNode {
  type?: string;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: unknown[];
}

function isTextblockType(type: string): boolean {
  return type === 'paragraph' || type === 'heading' || type === 'blockquote' || type === 'listItem';
}

/** Flatten the doc into one string per top-level textblock. */
function extractParagraphs(scriptDoc: TiptapDoc): string[] {
  const out: string[] = [];
  function visit(node: MaybeNode | null | undefined, depth: number): string {
    if (!node || typeof node !== 'object') return '';
    if (node.type === 'text' && typeof node.text === 'string') return node.text;
    let s = '';
    if (Array.isArray(node.content)) {
      for (const c of node.content) {
        s += visit(c as MaybeNode, depth + 1);
      }
    }
    if (typeof node.type === 'string' && depth > 0 && isTextblockType(node.type)) {
      out.push(s);
      return '';
    }
    return s;
  }
  visit(scriptDoc, 0);
  return out;
}

/**
 * Walk the doc and apply `componentTag` marks to every accepted suggestion.
 * For each suggestion we find the first occurrence of `text` inside the
 * paragraph at `paragraphIndex` and split surrounding text nodes so the
 * mark applies to exactly that range. Existing marks on the matched text
 * are preserved; we only add or replace the `componentTag` mark.
 */
function applyTagsToScriptDoc(
  doc: TiptapDoc,
  suggestions: RawTagSuggestion[],
  colorMap: Map<string, ComponentColor>,
): TiptapDoc {
  // Group suggestions by paragraph to apply them in a single pass per
  // paragraph (simpler bookkeeping than a global pass).
  const byParagraph = new Map<number, RawTagSuggestion[]>();
  for (const s of suggestions) {
    const list = byParagraph.get(s.paragraphIndex) ?? [];
    list.push(s);
    byParagraph.set(s.paragraphIndex, list);
  }

  let paragraphCounter = -1;
  function visit(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const node = input as MaybeNode;
    if (typeof node.type === 'string' && isTextblockType(node.type)) {
      paragraphCounter += 1;
      const localTags = byParagraph.get(paragraphCounter);
      const newContent = applyTagsWithinParagraph(
        (node.content ?? []) as MaybeNode[],
        localTags ?? [],
        colorMap,
      );
      return { ...node, content: newContent };
    }
    if (Array.isArray(node.content)) {
      return {
        ...node,
        content: (node.content as MaybeNode[]).map((c) => visit(c)),
      };
    }
    return node;
  }

  return visit(doc) as TiptapDoc;
}

function applyTagsWithinParagraph(
  content: MaybeNode[],
  tags: RawTagSuggestion[],
  colorMap: Map<string, ComponentColor>,
): MaybeNode[] {
  // Build a flat representation of the paragraph: { text, marks } per text
  // node. Nested non-text nodes are kept as-is and treated as opaque
  // separators (they can't be split for tagging).
  let working = [...content];
  for (const tag of tags) {
    const color = colorMap.get(tag.componentId);
    working = applySingleTag(working, tag.text, tag.componentId, color);
  }
  return working;
}

function applySingleTag(
  content: MaybeNode[],
  needle: string,
  componentId: string,
  color: ComponentColor | undefined,
): MaybeNode[] {
  // Concatenate adjacent text nodes' text to find the needle's position.
  // Mark each text node with its (start, end) offset in the paragraph
  // string so we can split the right one(s).
  interface TextSlot {
    kind: 'text';
    node: MaybeNode;
    text: string;
    start: number;
    end: number;
  }
  interface OtherSlot {
    kind: 'other';
    node: MaybeNode;
  }
  const slots: (TextSlot | OtherSlot)[] = [];
  let cursor = 0;
  for (const c of content) {
    if (c.type === 'text' && typeof c.text === 'string') {
      slots.push({
        kind: 'text',
        node: c,
        text: c.text,
        start: cursor,
        end: cursor + c.text.length,
      });
      cursor += c.text.length;
    } else {
      slots.push({ kind: 'other', node: c });
    }
  }
  const flat = slots
    .filter((s): s is TextSlot => s.kind === 'text')
    .map((s) => s.text)
    .join('');
  const matchStart = flat.indexOf(needle);
  if (matchStart < 0) return content;
  const matchEnd = matchStart + needle.length;

  const out: MaybeNode[] = [];
  for (const slot of slots) {
    if (slot.kind === 'other') {
      out.push(slot.node);
      continue;
    }
    if (slot.end <= matchStart || slot.start >= matchEnd) {
      out.push(slot.node);
      continue;
    }
    // This slot overlaps the match. Split into up to three pieces.
    const overlapStart = Math.max(slot.start, matchStart) - slot.start;
    const overlapEnd = Math.min(slot.end, matchEnd) - slot.start;
    const before = slot.text.slice(0, overlapStart);
    const middle = slot.text.slice(overlapStart, overlapEnd);
    const after = slot.text.slice(overlapEnd);
    const baseMarks = (slot.node.marks ?? []).filter((m) => m.type !== 'componentTag');
    const tagMark: { type: string; attrs: Record<string, unknown> } = {
      type: 'componentTag',
      attrs: {
        componentId,
        bg: color?.bg ?? null,
        fg: color?.fg ?? null,
      },
    };
    if (before.length > 0) {
      out.push({ ...slot.node, text: before, marks: baseMarks });
    }
    out.push({ ...slot.node, text: middle, marks: [...baseMarks, tagMark] });
    if (after.length > 0) {
      out.push({ ...slot.node, text: after, marks: baseMarks });
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
