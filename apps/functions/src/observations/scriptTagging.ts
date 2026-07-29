import { HttpsError } from 'firebase-functions/v2/https';
import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QuerySnapshot,
  Transaction,
} from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OBSERVATION_STATUS,
  geminiFeature,
  isAdminRole,
  roleYearMappingDocId,
  type ComponentColor,
  type GeminiFeature,
  type Observation,
  type Role,
  type RoleYearMapping,
  type Rubric,
  type RubricComponent,
  type TiptapDoc,
} from '@ops/shared';

/**
 * Shared machinery for the two-step script auto-tag flow:
 *
 *   1. `suggestScriptTags` — asks Gemini for candidate spans, filters them to
 *      verbatim matches, and returns them for the observer to review. Writes
 *      nothing.
 *   2. `applyScriptTags` — takes the subset the observer approved and writes
 *      `componentTag` marks into `observation.scriptDoc`.
 *
 * Both steps re-derive paragraphs and re-run {@link filterVerbatimSuggestions}
 * against whatever the script says *right now*. That is what makes the review
 * dialog safe to leave open: if the observer edits the script between the two
 * calls, the stale suggestions simply stop matching and are rejected rather
 * than being force-fit onto text they were never generated from.
 */

/** The wire shape a suggestion travels in, both out of step 1 and into step 2. */
export interface ScriptTagSuggestion {
  paragraphIndex: number;
  text: string;
  componentId: string;
}

export interface VerbatimFilterResult {
  /** Suggestions that still match the current script verbatim. */
  accepted: ScriptTagSuggestion[];
  /** Suggestions dropped because the component or the text no longer matches. */
  rejected: ScriptTagSuggestion[];
}

/**
 * Keep only suggestions whose `componentId` is currently assigned AND whose
 * `text` is a non-empty verbatim substring of the paragraph at
 * `paragraphIndex`. Everything else lands in `rejected`.
 */
export function filterVerbatimSuggestions(
  suggestions: readonly ScriptTagSuggestion[],
  paragraphs: readonly string[],
  validComponentIds: ReadonlySet<string>,
): VerbatimFilterResult {
  const accepted: ScriptTagSuggestion[] = [];
  const rejected: ScriptTagSuggestion[] = [];
  for (const s of suggestions) {
    if (!validComponentIds.has(s.componentId)) {
      rejected.push(s);
      continue;
    }
    const para = paragraphs[s.paragraphIndex];
    if (!para || s.text.trim().length === 0 || !para.includes(s.text)) {
      rejected.push(s);
      continue;
    }
    accepted.push(s);
  }
  return { accepted, rejected };
}

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Read `gemini.scriptAutoTag` from /appSettings/global. Raw Admin SDK reads
 * bypass Zod defaults, so a missing doc / missing field / malformed value all
 * fall back to the schema's own defaults (enabled, default model) rather than
 * throwing or silently disabling the feature.
 */
export async function loadScriptAutoTagFeature(db: Firestore): Promise<GeminiFeature> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const raw = snap.exists
    ? (snap.data()?.['gemini'] as { scriptAutoTag?: unknown } | undefined)?.scriptAutoTag
    : undefined;
  const parsed = geminiFeature.safeParse(raw ?? {});
  return parsed.success ? parsed.data : geminiFeature.parse({});
}

/** Throw the shared "admin turned this off" error unless auto-tag is enabled. */
export function assertScriptAutoTagEnabled(feature: GeminiFeature): void {
  if (!feature.enabled) {
    throw new HttpsError(
      'failed-precondition',
      'Script auto-tagging is currently disabled by an admin.',
    );
  }
}

// ─── Observation + rubric context ────────────────────────────────────────────

/**
 * The narrow read surface {@link resolveActiveComponents} needs. Firestore's
 * plain reads and a transaction's reads have different call shapes
 * (`ref.get()` vs `tx.get(ref)`), so both are funnelled through this — which
 * is what lets `applyScriptTags` re-derive the *same* component set from
 * inside its transaction instead of trusting a pre-transaction snapshot.
 */
export interface TaggingReader {
  getDoc(ref: DocumentReference): Promise<DocumentSnapshot>;
  getQuery(query: Query): Promise<QuerySnapshot>;
}

/** Reads straight off the database — no transaction, no consistency guarantee. */
export const directReader: TaggingReader = {
  getDoc: (ref) => ref.get(),
  getQuery: (query) => query.get(),
};

/**
 * Reads through a transaction, so every document read is locked against the
 * commit. Every call must happen before the transaction's first write —
 * Firestore rejects a read that follows a write in the same transaction.
 */
export function transactionReader(tx: Transaction): TaggingReader {
  return {
    getDoc: (ref) => tx.get(ref),
    getQuery: (query) => tx.get(query),
  };
}

/**
 * Enforce that this caller may auto-tag this observation at all: they are the
 * observer or an admin, and the observation is still an editable draft — a
 * finalized observation has an issued PDF and an emailed record, so no
 * AI-driven edit may touch it until it is reopened.
 *
 * The apply path calls this twice: once on the pre-transaction read to fail
 * fast and cheaply, and again on the read *inside* the transaction, because
 * the observation can be finalized (by the observer in another tab, or by an
 * admin) in the window between the review dialog opening and Apply.
 */
export function assertObservationTaggable(
  obs: Pick<Observation, 'status' | 'observerEmail'>,
  userEmail: string,
  callerRole: string | undefined,
): void {
  const isAdmin = isAdminRole(callerRole ?? null);
  if (!isAdmin && obs.observerEmail !== userEmail) {
    throw new HttpsError('permission-denied', 'Only the observer or an admin can auto-tag.');
  }
  if (obs.status !== OBSERVATION_STATUS.draft) {
    throw new HttpsError(
      'failed-precondition',
      'This observation is finalized — reopen it before tagging the script.',
    );
  }
}

export interface ActiveComponentSet {
  /** Components assigned to this observation's role/year, in rubric order. */
  activeComponents: RubricComponent[];
  componentColorMap: Map<string, ComponentColor>;
  /** `activeComponents` ids — the only ids a tag may reference. */
  validComponentIds: Set<string>;
}

/**
 * Resolve the rubric components this observation's script may be tagged
 * against, by walking role → rubric → role/year mapping through `reader`.
 *
 * This is deliberately re-runnable: the apply step re-derives it inside its
 * transaction, so a rubric edit or a role/year assignment change made while
 * the review dialog sat open cannot smuggle a component id onto the script
 * that is no longer assigned.
 */
export async function resolveActiveComponents(
  db: Firestore,
  reader: TaggingReader,
  obs: Pick<Observation, 'observedRole' | 'observedYear'>,
): Promise<ActiveComponentSet> {
  const roleByIdSnap = await reader.getQuery(
    db.collection(COLLECTIONS.roles).where('roleId', '==', obs.observedRole).limit(1),
  );
  const roleByNameSnap = roleByIdSnap.empty
    ? await reader.getQuery(
        db.collection(COLLECTIONS.roles).where('displayName', '==', obs.observedRole).limit(1),
      )
    : null;
  const roleDoc = !roleByIdSnap.empty ? roleByIdSnap.docs[0] : roleByNameSnap?.docs[0];
  if (!roleDoc) throw new HttpsError('failed-precondition', `Role "${obs.observedRole}" missing.`);
  const role = roleDoc.data() as Role;

  const rubricSnap = await reader.getDoc(db.doc(`${COLLECTIONS.rubrics}/${role.rubricId}`));
  if (!rubricSnap.exists) {
    throw new HttpsError('failed-precondition', `Rubric "${role.rubricId}" missing.`);
  }
  const rubric = rubricSnap.data() as Rubric;

  const mappingDocId = roleYearMappingDocId(role.roleId, obs.observedYear);
  const mappingSnap = await reader.getDoc(
    db.doc(`${COLLECTIONS.roleYearMappings}/${mappingDocId}`),
  );
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

  return {
    activeComponents,
    componentColorMap,
    validComponentIds: new Set(activeComponents.map((c) => c.id)),
  };
}

export interface TaggingContext extends ActiveComponentSet {
  obsRef: DocumentReference;
  scriptDoc: TiptapDoc;
  /** One flattened string per top-level textblock, as Gemini sees them. */
  paragraphs: string[];
}

/**
 * Resolve everything both steps need from an observation id: the doc ref, the
 * current script, and the rubric components the script may be tagged against.
 * Also enforces the caller's permission and that the observation is still an
 * editable draft.
 *
 * Everything here is read *outside* any transaction, so it is a fail-fast
 * gate, not a guarantee. `applyScriptTags` re-establishes both the draft
 * status and the component set from inside its transaction before writing.
 */
export async function loadTaggingContext(
  db: Firestore,
  observationId: string,
  userEmail: string,
  callerRole: string | undefined,
): Promise<TaggingContext> {
  const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
  const obsSnap = await obsRef.get();
  if (!obsSnap.exists) throw new HttpsError('not-found', 'Observation not found');
  const obs = obsSnap.data() as unknown as Observation;

  assertObservationTaggable(obs, userEmail, callerRole);

  const scriptDoc = obs.scriptDoc;
  if (!scriptDoc) {
    throw new HttpsError('failed-precondition', 'Script is empty — nothing to tag.');
  }
  const paragraphs = extractParagraphs(scriptDoc);
  if (paragraphs.every((p) => p.trim().length === 0)) {
    throw new HttpsError('failed-precondition', 'Script is empty — nothing to tag.');
  }

  const components = await resolveActiveComponents(db, directReader, obs);
  return { obsRef, scriptDoc, paragraphs, ...components };
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
export function extractParagraphs(scriptDoc: TiptapDoc): string[] {
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
export function applyTagsToScriptDoc(
  doc: TiptapDoc,
  suggestions: readonly ScriptTagSuggestion[],
  colorMap: ReadonlyMap<string, ComponentColor>,
): TiptapDoc {
  // Group suggestions by paragraph to apply them in a single pass per
  // paragraph (simpler bookkeeping than a global pass).
  const byParagraph = new Map<number, ScriptTagSuggestion[]>();
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
  tags: readonly ScriptTagSuggestion[],
  colorMap: ReadonlyMap<string, ComponentColor>,
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

export function colorFor(component: RubricComponent): ComponentColor {
  if (component.color) return component.color;
  const idx = hashStringToInt(component.id) % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx] ?? DEFAULT_COLOR;
}
