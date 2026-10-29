import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ComponentTagMark } from './component-tag-mark';

const POISON = '#fff;position:fixed;inset:0;background-image:url(//attacker.example/b)';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Load a doc with one tagged span into a read-only editor, as
 *  MeetingNotesSection does, and return the rendered <mark>. */
function renderMark(attrs: Record<string, unknown>): HTMLElement {
  editor = new Editor({
    element: document.createElement('div'),
    editable: false,
    extensions: [StarterKit, ComponentTagMark],
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Tagged.',
              marks: [{ type: 'componentTag', attrs: { componentId: '1a', ...attrs } }],
            },
          ],
        },
      ],
    },
  });
  const mark = editor.view.dom.querySelector<HTMLElement>('mark[data-component-tag]');
  if (!mark) throw new Error('mark not rendered');
  return mark;
}

describe('ComponentTagMark colours', () => {
  it('puts strict #RRGGBB colours in the inline style', () => {
    const mark = renderMark({ bg: '#dbeafe', fg: '#1e3a8a' });
    expect(mark.style.backgroundColor).toBe('rgb(219, 234, 254)');
    expect(mark.style.color).toBe('rgb(30, 58, 138)');
    expect(mark.getAttribute('data-bg')).toBe('#dbeafe');
  });

  it('drops bg/fg that carry extra CSS, leaving the CSS default', () => {
    const mark = renderMark({ bg: POISON, fg: `#000;${POISON}` });
    expect(mark.getAttribute('style')).toBeNull();
    expect(mark.getAttribute('data-bg')).toBeNull();
    expect(mark.getAttribute('data-fg')).toBeNull();
    expect(editor?.getHTML()).not.toContain('attacker.example');
  });

  it('drops non-hex and non-string values', () => {
    for (const bad of ['red', '#fff', 'rgb(0,0,0)', ' #dbeafe', 123, { a: 1 }]) {
      const mark = renderMark({ bg: bad, fg: bad });
      expect(mark.getAttribute('style')).toBeNull();
      editor?.destroy();
      editor = null;
    }
  });

  it('keeps a valid colour when only the other one is bad', () => {
    const mark = renderMark({ bg: '#dbeafe', fg: POISON });
    expect(mark.style.backgroundColor).toBe('rgb(219, 234, 254)');
    expect(mark.style.color).toBe('');
    expect(mark.style.length).toBe(1);
  });
});
