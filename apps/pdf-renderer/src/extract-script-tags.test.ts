/**
 * Behavior + parity-contract tests for extract-script-tags.ts.
 *
 * The pdf-renderer's extractTaggedSpansForComponent is a hand-maintained
 * mirror of apps/web/src/observations/extract-script-tags.ts (see the file's
 * opening comment). These tests guard two concerns:
 *
 *   1. **Behavior:** The function correctly extracts tagged spans from a
 *      Tiptap doc, merges adjacent same-paragraph runs, and preserves bg/fg
 *      colors.
 *
 *   2. **Parity contract:** The fixture inputs and expected outputs defined
 *      here form the canonical contract both the pdf-renderer mirror and the
 *      web implementation must satisfy.  Any algorithmic divergence between
 *      the two copies will surface when the corresponding web-side test (or
 *      the cross-file CI diff) is checked — and is visible in this file as
 *      the authoritative spec.
 */

import { describe, expect, it } from 'vitest';
import type { TiptapDoc } from '@ops/shared';
import { extractTaggedSpansForComponent } from './extract-script-tags.js';

// ---------------------------------------------------------------------------
// Shared fixture documents
// ---------------------------------------------------------------------------

/** A single paragraph with one tagged span for component 1a. */
const SIMPLE_DOC: TiptapDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'untagged text ',
        },
        {
          type: 'text',
          text: 'tagged for 1a',
          marks: [
            {
              type: 'componentTag',
              attrs: { componentId: '1a', bg: '#eaecf5', fg: '#1d2a5d' },
            },
          ],
        },
        {
          type: 'text',
          text: ' more untagged',
        },
      ],
    },
  ],
};

/** Two paragraphs; second has two adjacent tagged runs (should merge). */
const ADJACENT_RUNS_DOC: TiptapDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Not tagged',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'First run ',
          marks: [{ type: 'componentTag', attrs: { componentId: '1a', bg: null, fg: null } }],
        },
        {
          type: 'text',
          text: 'second run',
          marks: [{ type: 'componentTag', attrs: { componentId: '1a', bg: null, fg: null } }],
        },
      ],
    },
  ],
};

/** Two paragraphs each with a span for 1a (should NOT merge across paras). */
const MULTI_PARAGRAPH_DOC: TiptapDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'para one span',
          marks: [{ type: 'componentTag', attrs: { componentId: '1a', bg: '#eee', fg: '#111' } }],
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'para two span',
          marks: [{ type: 'componentTag', attrs: { componentId: '1a', bg: '#eee', fg: '#111' } }],
        },
      ],
    },
  ],
};

/** A doc that has spans for two different components. */
const MULTI_COMPONENT_DOC: TiptapDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'span for 1a',
          marks: [{ type: 'componentTag', attrs: { componentId: '1a', bg: null, fg: null } }],
        },
        {
          type: 'text',
          text: ' span for 1b',
          marks: [{ type: 'componentTag', attrs: { componentId: '1b', bg: null, fg: null } }],
        },
      ],
    },
  ],
};

/** An empty doc. */
const EMPTY_DOC: TiptapDoc = { type: 'doc', content: [] };

// ---------------------------------------------------------------------------
// Behavior tests
// ---------------------------------------------------------------------------

describe('extractTaggedSpansForComponent', () => {
  it('returns [] when scriptDoc is undefined', () => {
    expect(extractTaggedSpansForComponent(undefined, '1a')).toEqual([]);
  });

  it('returns [] for an empty doc', () => {
    expect(extractTaggedSpansForComponent(EMPTY_DOC, '1a')).toEqual([]);
  });

  it('returns [] when the component has no tagged spans', () => {
    expect(extractTaggedSpansForComponent(SIMPLE_DOC, 'MISSING')).toEqual([]);
  });

  it('extracts a single tagged span with correct text and colors', () => {
    const spans = extractTaggedSpansForComponent(SIMPLE_DOC, '1a');
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span).toBeDefined();
    expect(span?.text).toBe('tagged for 1a');
    expect(span?.bg).toBe('#eaecf5');
    expect(span?.fg).toBe('#1d2a5d');
  });

  it('merges adjacent tagged runs in the same paragraph', () => {
    const spans = extractTaggedSpansForComponent(ADJACENT_RUNS_DOC, '1a');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.text).toBe('First run second run');
  });

  it('produces separate entries for spans in different paragraphs', () => {
    const spans = extractTaggedSpansForComponent(MULTI_PARAGRAPH_DOC, '1a');
    expect(spans).toHaveLength(2);
    expect(spans[0]?.text).toBe('para one span');
    expect(spans[1]?.text).toBe('para two span');
    expect(spans[0]?.paragraphIndex).not.toBe(spans[1]?.paragraphIndex);
  });

  it('returns only spans for the requested component, ignoring others', () => {
    const spansA = extractTaggedSpansForComponent(MULTI_COMPONENT_DOC, '1a');
    const spansB = extractTaggedSpansForComponent(MULTI_COMPONENT_DOC, '1b');
    expect(spansA).toHaveLength(1);
    expect(spansA[0]?.text).toBe('span for 1a');
    expect(spansB).toHaveLength(1);
    expect(spansB[0]?.text).toBe(' span for 1b');
  });

  it('preserves null bg/fg when attrs carry nulls', () => {
    const spans = extractTaggedSpansForComponent(ADJACENT_RUNS_DOC, '1a');
    expect(spans[0]?.bg).toBeNull();
    expect(spans[0]?.fg).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Parity-contract snapshots
//
// These snapshots define the canonical output contract that BOTH the
// pdf-renderer implementation (above) and its web mirror must satisfy.
// If either copy's algorithm diverges from these expected shapes, the
// corresponding workspace's tests will fail, making drift detectable in CI.
// ---------------------------------------------------------------------------

describe('extractTaggedSpansForComponent parity contract', () => {
  it('SIMPLE_DOC/1a: one span, text="tagged for 1a", bg=#eaecf5, fg=#1d2a5d', () => {
    expect(extractTaggedSpansForComponent(SIMPLE_DOC, '1a')).toEqual([
      { text: 'tagged for 1a', paragraphIndex: 0, bg: '#eaecf5', fg: '#1d2a5d' },
    ]);
  });

  it('ADJACENT_RUNS_DOC/1a: adjacent runs merged, second paragraph', () => {
    // Paragraph 0 is "Not tagged" (no match).
    // Paragraph 1 contains two adjacent tagged runs that must merge.
    expect(extractTaggedSpansForComponent(ADJACENT_RUNS_DOC, '1a')).toEqual([
      { text: 'First run second run', paragraphIndex: 1, bg: null, fg: null },
    ]);
  });

  it('MULTI_PARAGRAPH_DOC/1a: two separate spans across two paragraphs', () => {
    expect(extractTaggedSpansForComponent(MULTI_PARAGRAPH_DOC, '1a')).toEqual([
      { text: 'para one span', paragraphIndex: 0, bg: '#eee', fg: '#111' },
      { text: 'para two span', paragraphIndex: 1, bg: '#eee', fg: '#111' },
    ]);
  });

  it('MULTI_COMPONENT_DOC/1a: only span for 1a', () => {
    expect(extractTaggedSpansForComponent(MULTI_COMPONENT_DOC, '1a')).toEqual([
      { text: 'span for 1a', paragraphIndex: 0, bg: null, fg: null },
    ]);
  });

  it('MULTI_COMPONENT_DOC/1b: only span for 1b', () => {
    expect(extractTaggedSpansForComponent(MULTI_COMPONENT_DOC, '1b')).toEqual([
      { text: ' span for 1b', paragraphIndex: 0, bg: null, fg: null },
    ]);
  });
});
