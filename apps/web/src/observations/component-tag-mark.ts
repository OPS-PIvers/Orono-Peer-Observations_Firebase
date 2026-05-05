import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Tiptap mark that links a span of script text to a rubric component.
 *
 * Renders as `<mark data-component-tag data-component-id="1a" style="background-color:…;color:…">…</mark>`.
 * The CSS in index.css gives marks with `[data-component-tag]` a tinted
 * fallback background for tags written before per-component colors were
 * stored on the mark itself. When the doc is finalized for PDF rendering,
 * the renderer walks the doc and groups marked spans by componentId.
 *
 * Stored shape in the Tiptap JSON document:
 *   { type: 'text',
 *     marks: [{ type: 'componentTag',
 *               attrs: { componentId: '1a', bg: '#dbeafe', fg: '#1e3a8a' } }],
 *     text: '…' }
 */
export const ComponentTagMark = Mark.create({
  name: 'componentTag',

  addAttributes() {
    return {
      componentId: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-component-id'),
        renderHTML: (attributes) => {
          const componentId = attributes['componentId'] as string | null;
          if (!componentId) return {};
          return { 'data-component-id': componentId };
        },
      },
      bg: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-bg'),
        renderHTML: (attributes) => {
          const bg = attributes['bg'] as string | null;
          if (!bg) return {};
          return { 'data-bg': bg };
        },
      },
      fg: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-fg'),
        renderHTML: (attributes) => {
          const fg = attributes['fg'] as string | null;
          if (!fg) return {};
          return { 'data-fg': fg };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-component-tag]' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    const bg = (mark.attrs as { bg?: string | null }).bg;
    const fg = (mark.attrs as { fg?: string | null }).fg;
    const styleParts: string[] = [];
    if (bg) styleParts.push(`background-color:${bg}`);
    if (fg) styleParts.push(`color:${fg}`);
    const extra: Record<string, string> = { 'data-component-tag': '' };
    if (styleParts.length > 0) extra['style'] = styleParts.join(';');
    return ['mark', mergeAttributes(HTMLAttributes, extra), 0];
  },

  /**
   * `inclusive: false` keeps newly-typed text from extending an existing
   * tag. The user has to deliberately re-tag.
   */
  inclusive: false,
});
