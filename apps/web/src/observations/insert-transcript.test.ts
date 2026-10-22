import { describe, expect, it } from 'vitest';
import type { TiptapDoc, TranscriptSummary } from '@ops/shared';
import {
  appendTranscriptSummaryToScriptDoc,
  appendTranscriptToScriptDoc,
  isScriptDocEmpty,
} from './insert-transcript';

const EMPTY_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

function docWithText(text: string): TiptapDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('isScriptDocEmpty', () => {
  it('treats undefined and the pristine Tiptap doc as empty', () => {
    expect(isScriptDocEmpty(undefined)).toBe(true);
    expect(isScriptDocEmpty(EMPTY_DOC)).toBe(true);
  });

  it('treats whitespace-only text as empty', () => {
    expect(isScriptDocEmpty(docWithText('   '))).toBe(true);
  });

  it('treats real text as non-empty', () => {
    expect(isScriptDocEmpty(docWithText('Teacher greets students.'))).toBe(false);
  });
});

describe('appendTranscriptToScriptDoc', () => {
  it('replaces an empty script with a heading + one paragraph per line', () => {
    const result = appendTranscriptToScriptDoc(
      EMPTY_DOC,
      'First sentence.\nSecond sentence.\n\nThird sentence.',
      'Transcript — Recording 1',
    );
    expect(result.content).toEqual([
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Transcript — Recording 1' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'First sentence.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second sentence.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Third sentence.' }] },
    ]);
  });

  it('appends after existing script content without mutating the input', () => {
    const existing = docWithText('Hand-typed note.');
    const before = JSON.stringify(existing);
    const result = appendTranscriptToScriptDoc(existing, 'Spoken words.', 'Transcript');
    expect(JSON.stringify(existing)).toBe(before);
    expect(result.content).toHaveLength(3);
    expect(result.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Hand-typed note.' }],
    });
    expect(result.content[1]).toEqual({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'Transcript' }],
    });
  });

  it('handles a scriptDoc that is undefined', () => {
    const result = appendTranscriptToScriptDoc(undefined, 'Only line.', 'Transcript');
    expect(result.type).toBe('doc');
    expect(result.content).toHaveLength(2);
  });

  it('produces paragraphs geminiTagScript-style textblock walking can see', () => {
    // Mirror of extractParagraphs in apps/functions: every top-level
    // textblock (heading or paragraph) yields one entry.
    const result = appendTranscriptToScriptDoc(EMPTY_DOC, 'A.\nB.', 'Transcript — Recording 2');
    const types = result.content.map((n) => (n as { type: string }).type);
    expect(types).toEqual(['heading', 'paragraph', 'paragraph']);
  });
});

describe('appendTranscriptSummaryToScriptDoc', () => {
  const summary: TranscriptSummary = {
    mode: 'domains',
    focus: null,
    summary: 'A lesson on peer pressure.',
    sections: [
      {
        componentId: '2b',
        heading: 'Culture for Learning',
        noticed: 'Sharing was voluntary.',
        evidence: [
          { time: '04:53', text: 'Teacher invites students to share.' },
          { time: null, text: 'Thanks a volunteer.' },
        ],
      },
      { componentId: null, heading: 'Other', noticed: '', evidence: [] },
    ],
    reflectionQuestions: ['2b: What helped students share?'],
    components: [
      { componentId: '2b', title: 'Culture for Learning', bg: '#dcfce7', fg: '#14532d' },
    ],
  };
  const tag = {
    type: 'componentTag',
    attrs: { componentId: '2b', bg: '#dcfce7', fg: '#14532d', source: 'script' },
  };

  it('appends summary, tagged evidence and reflection questions under the label', () => {
    const result = appendTranscriptSummaryToScriptDoc(
      docWithText('Typed note.'),
      summary,
      'Assigned-domain evidence — Recording 1',
    );
    expect(result.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Typed note.' }] },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Assigned-domain evidence — Recording 1' }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Summary. ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'A lesson on peer pressure.' },
        ],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '2b Culture for Learning. ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'Sharing was voluntary.' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: '[04:53] ' },
                  { type: 'text', text: 'Teacher invites students to share.', marks: [tag] },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Thanks a volunteer.', marks: [tag] }],
              },
            ],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Other', marks: [{ type: 'bold' }] }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Reflection questions', marks: [{ type: 'bold' }] }],
      },
      {
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '2b: What helped students share?' }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('leads with the focus for a custom summary and replaces an empty script', () => {
    const result = appendTranscriptSummaryToScriptDoc(
      EMPTY_DOC,
      { ...summary, mode: 'custom', focus: 'Feedback', sections: [], reflectionQuestions: [] },
      'Custom focus',
    );
    expect(result.content.slice(1, 2)).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Focus. ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'Feedback' },
        ],
      },
    ]);
    expect(result.content).toHaveLength(3);
  });
});
