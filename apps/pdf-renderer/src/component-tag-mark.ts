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
      bg: {
        default: null as string | null,
        parseHTML: (element: MinimalElement) => element.getAttribute('data-bg'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const bg = attributes['bg'];
          if (typeof bg !== 'string' || bg.length === 0) return {};
          return { 'data-bg': bg };
        },
      },
      fg: {
        default: null as string | null,
        parseHTML: (element: MinimalElement) => element.getAttribute('data-fg'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const fg = attributes['fg'];
          if (typeof fg !== 'string' || fg.length === 0) return {};
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
  inclusive: false,
});
