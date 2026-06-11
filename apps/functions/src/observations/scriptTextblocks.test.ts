import { describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { OBSERVATION_STATUS, type ComponentColor, type TiptapDoc } from '@ops/shared';
import {
  applyTagsToScriptDoc,
  extractParagraphs,
  type MaybeNode,
  type RawTagSuggestion,
} from './scriptTextblocks.js';

// ── Tiptap fixture builders ──────────────────────────────────────────────────
const text = (t: string): MaybeNode => ({ type: 'text', text: t });
const para = (...content: MaybeNode[]): MaybeNode => ({ type: 'paragraph', content });
const heading = (...content: MaybeNode[]): MaybeNode => ({ type: 'heading', content });
const listItem = (...content: MaybeNode[]): MaybeNode => ({ type: 'listItem', content });
const bulletList = (...content: MaybeNode[]): MaybeNode => ({ type: 'bulletList', content });
const blockquote = (...content: MaybeNode[]): MaybeNode => ({ type: 'blockquote', content });
const docOf = (...content: MaybeNode[]): TiptapDoc =>
  ({ type: 'doc', content }) as unknown as TiptapDoc;

/** Collect every text span carrying a componentTag mark, in document order. */
function taggedSpans(
  node: MaybeNode | undefined,
  acc: { text: string; componentId: unknown }[] = [],
): { text: string; componentId: unknown }[] {
  if (node?.type === 'text' && Array.isArray(node.marks)) {
    const tag = node.marks.find((m) => m.type === 'componentTag');
    if (tag) acc.push({ text: node.text ?? '', componentId: tag.attrs?.['componentId'] });
  }
  if (Array.isArray(node?.content)) {
    for (const c of node.content) taggedSpans(c as MaybeNode, acc);
  }
  return acc;
}

// A doc that mixes plain paragraphs, a bullet list, a blockquote, and a
// heading — exactly the shapes the old divergent counting got wrong.
const mixedDoc = docOf(
  para(text('First para')),
  bulletList(listItem(para(text('Bullet one'))), listItem(para(text('Bullet two')))),
  blockquote(para(text('A quote'))),
  heading(text('A heading')),
);

const colorMap = new Map<string, ComponentColor>([['c1', { bg: '#eee', fg: '#111' }]]);

describe('extractParagraphs', () => {
  it('yields one entry per leaf textblock in document order', () => {
    expect(extractParagraphs(mixedDoc)).toEqual([
      'First para',
      'Bullet one',
      'Bullet two',
      'A quote',
      'A heading',
    ]);
  });

  it('concatenates inline text within a textblock', () => {
    const doc = docOf(para(text('Hello '), text('world')));
    expect(extractParagraphs(doc)).toEqual(['Hello world']);
  });
});

describe('applyTagsToScriptDoc index alignment', () => {
  it('maps each suggestion index to the same block extractParagraphs counted', () => {
    const suggestions: RawTagSuggestion[] = [
      { paragraphIndex: 1, text: 'Bullet one', componentId: 'c1' },
      { paragraphIndex: 3, text: 'A quote', componentId: 'c1' },
    ];
    const out = applyTagsToScriptDoc(mixedDoc, suggestions, colorMap);
    // The tags land on the list-item paragraph and the blockquote paragraph —
    // not a sibling block, and not dropped.
    expect(taggedSpans(out)).toEqual([
      { text: 'Bullet one', componentId: 'c1' },
      { text: 'A quote', componentId: 'c1' },
    ]);
  });

  it('round-trips: tagging index i with paragraph i always hits paragraph i', () => {
    const paras = extractParagraphs(mixedDoc);
    paras.forEach((p, i) => {
      const out = applyTagsToScriptDoc(
        mixedDoc,
        [{ paragraphIndex: i, text: p, componentId: 'cX' }],
        colorMap,
      );
      const spans = taggedSpans(out);
      expect(spans).toHaveLength(1);
      expect(spans[0]?.text).toBe(p);
    });
  });

  it('preserves existing non-componentTag marks when splitting a span', () => {
    const doc = docOf({
      type: 'paragraph',
      content: [{ type: 'text', text: 'bold words here', marks: [{ type: 'bold' }] }],
    });
    const out = applyTagsToScriptDoc(
      doc,
      [{ paragraphIndex: 0, text: 'words', componentId: 'c1' }],
      colorMap,
    );
    const spans = taggedSpans(out);
    expect(spans).toEqual([{ text: 'words', componentId: 'c1' }]);
    // The tagged span keeps the pre-existing bold mark alongside componentTag.
    const taggedNode = findText(out, 'words');
    expect(taggedNode?.marks?.some((m) => m.type === 'bold')).toBe(true);
  });

  it('leaves the doc untouched when a suggestion text is not found verbatim', () => {
    const out = applyTagsToScriptDoc(
      mixedDoc,
      [{ paragraphIndex: 0, text: 'not present', componentId: 'c1' }],
      colorMap,
    );
    expect(taggedSpans(out)).toEqual([]);
  });
});

// ── geminiTagScript helpers ──────────────────────────────────────────────────
// The callable's module registers Firebase params/handlers at import time, so
// (like index.test.ts) set fake env first and import dynamically.
async function importGeminiTagScript() {
  process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
  process.env['GCLOUD_PROJECT'] = 'test';
  return import('./geminiTagScript.js');
}

async function importBuildAutoTagResult() {
  const mod = await importGeminiTagScript();
  return mod.buildAutoTagResult;
}

describe('buildAutoTagResult (geminiTagScript response shape)', () => {
  it('returns counts plus the tagged scriptDoc the editor re-hydrates from', async () => {
    const buildAutoTagResult = await importBuildAutoTagResult();
    const result = buildAutoTagResult(
      mixedDoc,
      extractParagraphs(mixedDoc),
      [
        { paragraphIndex: 0, text: 'First para', componentId: 'c1' },
        // Skipped: not a verbatim substring of paragraph 1.
        { paragraphIndex: 1, text: 'not in the paragraph', componentId: 'c1' },
        // Skipped: component not assigned for this role/year.
        { paragraphIndex: 3, text: 'A quote', componentId: 'unassigned' },
      ],
      new Set(['c1']),
      colorMap,
    );
    expect(result.taggedCount).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(taggedSpans(result.scriptDoc)).toEqual([{ text: 'First para', componentId: 'c1' }]);
  });

  it('skips whitespace-only and out-of-range suggestions, returning the doc untagged', async () => {
    const buildAutoTagResult = await importBuildAutoTagResult();
    const result = buildAutoTagResult(
      mixedDoc,
      extractParagraphs(mixedDoc),
      [
        { paragraphIndex: 99, text: 'First para', componentId: 'c1' },
        // A single space IS a verbatim substring of 'First para' — only the
        // whitespace-only guard rejects it.
        { paragraphIndex: 0, text: ' ', componentId: 'c1' },
      ],
      new Set(['c1']),
      colorMap,
    );
    expect(result.taggedCount).toBe(0);
    expect(result.skippedCount).toBe(2);
    expect(taggedSpans(result.scriptDoc)).toEqual([]);
  });
});

// ── geminiTagScript.assertDraftForAutoTag ────────────────────────────────────
// Finalized observations must stay immutable through every server entry point.
// The callable writes scriptDoc with the Admin SDK (which bypasses the rules
// that lock Finalized docs), so it enforces the Draft-only invariant itself.
describe('assertDraftForAutoTag (Finalized observation guard)', () => {
  it('lets a Draft observation through', async () => {
    const { assertDraftForAutoTag } = await importGeminiTagScript();
    expect(() => {
      assertDraftForAutoTag(OBSERVATION_STATUS.draft);
    }).not.toThrow();
  });

  it('throws failed-precondition for a Finalized observation', async () => {
    const { assertDraftForAutoTag } = await importGeminiTagScript();
    let caught: unknown;
    try {
      assertDraftForAutoTag(OBSERVATION_STATUS.finalized);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpsError);
    const err = caught as HttpsError;
    expect(err.code).toBe('failed-precondition');
    expect(err.message).toMatch(/finalized/i);
  });
});

function findText(node: MaybeNode | undefined, t: string): MaybeNode | undefined {
  if (node?.type === 'text' && node.text === t) return node;
  if (Array.isArray(node?.content)) {
    for (const c of node.content) {
      const hit = findText(c as MaybeNode, t);
      if (hit) return hit;
    }
  }
  return undefined;
}
