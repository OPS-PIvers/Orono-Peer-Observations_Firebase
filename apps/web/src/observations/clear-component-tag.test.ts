import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ComponentTagMark } from './component-tag-mark';
import { clearComponentTag } from './clear-component-tag';

function tag(componentId: string) {
  return { type: 'componentTag', attrs: { componentId, bg: null, fg: null, source: 'script' } };
}

// "Hello " untagged, "tagged words" as 1a, " and " untagged, "other" as 2b.
function makeEditor() {
  return new Editor({
    extensions: [StarterKit, ComponentTagMark],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'tagged ', marks: [tag('1a')] },
            { type: 'text', text: 'words', marks: [tag('1a')] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'other', marks: [tag('2b')] },
          ],
        },
      ],
    },
  });
}

function taggedText(editor: Editor): Record<string, string> {
  const out: Record<string, string> = {};
  editor.state.doc.descendants((node) => {
    const mark = node.marks.find((m) => m.type.name === 'componentTag');
    if (node.text !== undefined && mark) {
      const id = mark.attrs['componentId'] as string;
      out[id] = (out[id] ?? '') + node.text;
    }
  });
  return out;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('clearComponentTag', () => {
  it('removes the whole tagged segment when the cursor sits inside it', () => {
    editor = makeEditor();
    // Paragraph content starts at 1; "Hello " is 6 chars, so 10 is inside "tagged".
    editor.commands.setTextSelection(10);
    clearComponentTag(editor);
    expect(taggedText(editor)).toEqual({ '2b': 'other' });
    expect(editor.state.selection.from).toBe(10);
  });

  it('only removes the selected part when there is a selection', () => {
    editor = makeEditor();
    // Select "tagged " (positions 7..14).
    editor.commands.setTextSelection({ from: 7, to: 14 });
    clearComponentTag(editor);
    expect(taggedText(editor)).toEqual({ '1a': 'words', '2b': 'other' });
  });
});
