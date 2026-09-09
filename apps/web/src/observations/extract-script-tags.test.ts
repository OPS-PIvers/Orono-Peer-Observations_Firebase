import { describe, expect, it } from 'vitest';
import type { TiptapDoc } from '@ops/shared';
import {
  buildScriptNotesDoc,
  extractTaggedSpansForComponent,
  tagSourceOf,
} from './extract-script-tags';

function tagged(text: string, attrs: Record<string, unknown>) {
  return { type: 'text', text, marks: [{ type: 'componentTag', attrs }] };
}

const DOC: TiptapDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [tagged('Observed grouping.', { componentId: '1a' })] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: "Teacher's Planning response", marks: [{ type: 'italic' }] }],
    },
    {
      type: 'paragraph',
      content: [tagged('I group by readiness.', { componentId: '1a', source: 'planning' })],
    },
    {
      type: 'paragraph',
      content: [tagged('Unrelated.', { componentId: '2b', source: 'reflection' })],
    },
  ],
};

describe('tagSourceOf', () => {
  it('defaults anything unknown to script', () => {
    expect(tagSourceOf(undefined)).toBe('script');
    expect(tagSourceOf('bogus')).toBe('script');
    expect(tagSourceOf('planning')).toBe('planning');
    expect(tagSourceOf('reflection')).toBe('reflection');
  });
});

describe('extractTaggedSpansForComponent', () => {
  it('carries the source through, defaulting pre-existing tags to script', () => {
    const spans = extractTaggedSpansForComponent(DOC, '1a');
    expect(spans.map((s) => [s.text, s.source])).toEqual([
      ['Observed grouping.', 'script'],
      ['I group by readiness.', 'planning'],
    ]);
  });

  it('does not sweep in the attribution paragraph, which is untagged', () => {
    const spans = extractTaggedSpansForComponent(DOC, '1a');
    expect(spans.some((s) => s.text.includes('Planning response'))).toBe(false);
  });
});

describe('buildScriptNotesDoc', () => {
  it('prefixes lifted spans with an italic attribution and keeps the source on the mark', () => {
    const doc = buildScriptNotesDoc(extractTaggedSpansForComponent(DOC, '1a'), '1a');
    const [first, second] = doc.content as {
      content: { text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }[];
    }[];
    expect(first?.content).toHaveLength(1);
    expect(second?.content.map((n) => n.text)).toEqual([
      "Teacher's Planning response: ",
      'I group by readiness.',
    ]);
    expect(second?.content[0]?.marks).toEqual([{ type: 'italic' }]);
    expect(second?.content[1]?.marks?.[0]?.attrs?.['source']).toBe('planning');
  });
});
