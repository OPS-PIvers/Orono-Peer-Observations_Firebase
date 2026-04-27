import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Server-side mirror of the client `componentTag` Tiptap mark
 * (apps/web/src/observations/component-tag-mark.ts). Used by
 * `@tiptap/html` when rendering the script doc to HTML for PDF output —
 * keeping the mark definition in sync ensures tagged spans survive the
 * round-trip from Firestore → PDF.
 */
export const ComponentTagMark = Mark.create({
  name: 'componentTag',
  addAttributes() {
    // parseHTML is only invoked when Tiptap is asked to round-trip HTML
    // back into a doc — which the renderer never does. Stub it with a
    // structural element type so we don't pull in lib.dom on the server.
    interface MinimalElement {
      getAttribute(name: string): string | null;
    }
    return {
      componentId: {
        default: null as string | null,
        parseHTML: (element: MinimalElement) => element.getAttribute('data-component-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const componentId = attributes['componentId'];
          if (typeof componentId !== 'string' || componentId.length === 0) return {};
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
  inclusive: false,
});
