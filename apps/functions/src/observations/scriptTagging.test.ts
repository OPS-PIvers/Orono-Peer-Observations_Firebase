import { describe, expect, it } from 'vitest';
import type { ComponentColor, TiptapDoc } from '@ops/shared';
import {
  applyTagsToScriptDoc,
  extractParagraphs,
  filterVerbatimSuggestions,
  type ScriptTagSuggestion,
} from './scriptTagging.js';

const COLORS: ReadonlyMap<string, ComponentColor> = new Map([
  ['1a', { bg: '#dbeafe', fg: '#1e3a8a' }],
]);

function doc(...paragraphs: string[]): TiptapDoc {
  return {
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  } as unknown as TiptapDoc;
}

interface TextNode {
  type?: string;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: TextNode[];
}

/** Flatten a doc into the text runs that carry a componentTag mark. */
function taggedRuns(d: TiptapDoc): { text: string; componentId: unknown }[] {
  const out: { text: string; componentId: unknown }[] = [];
  function walk(node: TextNode | undefined): void {
    if (!node) return;
    if (node.type === 'text' && typeof node.text === 'string') {
      const mark = node.marks?.find((m) => m.type === 'componentTag');
      if (mark) out.push({ text: node.text, componentId: mark.attrs?.['componentId'] });
    }
    for (const child of node.content ?? []) walk(child);
  }
  walk(d as unknown as TextNode);
  return out;
}

describe('extractParagraphs', () => {
  it('emits one string per top-level textblock', () => {
    expect(extractParagraphs(doc('first line', 'second line'))).toEqual([
      'first line',
      'second line',
    ]);
  });

  it('joins split text nodes inside one paragraph', () => {
    const d = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'students ' },
            { type: 'text', text: 'discussed', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' in pairs' },
          ],
        },
      ],
    } as unknown as TiptapDoc;
    expect(extractParagraphs(d)).toEqual(['students discussed in pairs']);
  });
});

describe('filterVerbatimSuggestions', () => {
  const paragraphs = ['Students turned and talked.', 'The teacher circulated.'];
  const valid = new Set(['1a', '2b']);

  it('accepts a suggestion whose text is a verbatim substring', () => {
    const s: ScriptTagSuggestion = {
      paragraphIndex: 0,
      text: 'turned and talked',
      componentId: '1a',
    };
    const { accepted, rejected } = filterVerbatimSuggestions([s], paragraphs, valid);
    expect(accepted).toEqual([s]);
    expect(rejected).toEqual([]);
  });

  it('rejects text that is not in the referenced paragraph', () => {
    const s: ScriptTagSuggestion = {
      paragraphIndex: 0,
      text: 'The teacher circulated',
      componentId: '1a',
    };
    const { accepted, rejected } = filterVerbatimSuggestions([s], paragraphs, valid);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([s]);
  });

  it('rejects a paraphrase (near-miss) rather than fuzzy-matching it', () => {
    const s: ScriptTagSuggestion = {
      paragraphIndex: 0,
      text: 'students turned and talked',
      componentId: '1a',
    };
    expect(filterVerbatimSuggestions([s], paragraphs, valid).accepted).toEqual([]);
  });

  it('rejects an out-of-range paragraph index', () => {
    const s: ScriptTagSuggestion = { paragraphIndex: 9, text: 'anything', componentId: '1a' };
    expect(filterVerbatimSuggestions([s], paragraphs, valid).rejected).toEqual([s]);
  });

  it('rejects a component that is not assigned for this role/year', () => {
    const s: ScriptTagSuggestion = {
      paragraphIndex: 1,
      text: 'circulated',
      componentId: '4e',
    };
    expect(filterVerbatimSuggestions([s], paragraphs, valid).rejected).toEqual([s]);
  });

  it('rejects whitespace-only text', () => {
    const s: ScriptTagSuggestion = { paragraphIndex: 0, text: '   ', componentId: '1a' };
    expect(filterVerbatimSuggestions([s], paragraphs, valid).rejected).toEqual([s]);
  });
});

describe('applyTagsToScriptDoc', () => {
  it('marks exactly the matched span and leaves the rest untouched', () => {
    const out = applyTagsToScriptDoc(
      doc('Students turned and talked.'),
      [{ paragraphIndex: 0, text: 'turned and talked', componentId: '1a' }],
      COLORS,
    );
    expect(taggedRuns(out)).toEqual([{ text: 'turned and talked', componentId: '1a' }]);
    expect(extractParagraphs(out)).toEqual(['Students turned and talked.']);
  });

  it('applies each suggestion to its own paragraph', () => {
    const out = applyTagsToScriptDoc(
      doc('Students turned and talked.', 'The teacher circulated.'),
      [
        { paragraphIndex: 0, text: 'turned', componentId: '1a' },
        { paragraphIndex: 1, text: 'circulated', componentId: '1a' },
      ],
      COLORS,
    );
    expect(taggedRuns(out).map((r) => r.text)).toEqual(['turned', 'circulated']);
  });

  it('carries the component color onto the mark', () => {
    const out = applyTagsToScriptDoc(
      doc('Students turned and talked.'),
      [{ paragraphIndex: 0, text: 'turned', componentId: '1a' }],
      COLORS,
    );
    const runs = (out as unknown as TextNode).content?.[0]?.content ?? [];
    const marked = runs.find((n) => n.marks?.some((m) => m.type === 'componentTag'));
    expect(marked?.marks?.[0]?.attrs).toEqual({
      componentId: '1a',
      bg: '#dbeafe',
      fg: '#1e3a8a',
    });
  });

  it('preserves existing non-tag marks on the matched text', () => {
    const d = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'turned and talked', marks: [{ type: 'bold' }] }],
        },
      ],
    } as unknown as TiptapDoc;
    const out = applyTagsToScriptDoc(
      d,
      [{ paragraphIndex: 0, text: 'turned', componentId: '1a' }],
      COLORS,
    );
    const runs = (out as unknown as TextNode).content?.[0]?.content ?? [];
    expect(runs[0]?.marks?.map((m) => m.type)).toEqual(['bold', 'componentTag']);
  });

  it('is a no-op when there are no suggestions', () => {
    const source = doc('Students turned and talked.');
    const out = applyTagsToScriptDoc(source, [], COLORS);
    expect(taggedRuns(out)).toEqual([]);
    expect(extractParagraphs(out)).toEqual(['Students turned and talked.']);
  });
});
