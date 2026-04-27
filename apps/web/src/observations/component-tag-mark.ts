import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Tiptap mark that links a span of script text to a rubric component.
 *
 * Renders as `<mark data-component-tag data-component-id="1a">…</mark>`.
 * The CSS in index.css gives marks with `[data-component-tag]` a tinted
 * background. When the doc is finalized for PDF rendering, the renderer
 * walks the doc and groups marked spans by componentId.
 *
 * Stored shape in the Tiptap JSON document:
 *   { type: 'text', marks: [{ type: 'componentTag', attrs: { componentId: '1a' } }], text: '…' }
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
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-component-tag]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { 'data-component-tag': '' }), 0];
  },

  /**
   * `inclusive: false` keeps newly-typed text from extending an existing
   * tag. The user has to deliberately re-tag.
   */
  inclusive: false,
});
