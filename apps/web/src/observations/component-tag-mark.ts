import { Mark, mergeAttributes } from '@tiptap/core';
import { isHexColor } from '@ops/shared';

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
 *               attrs: { componentId: '1a', bg: '#dbeafe', fg: '#1e3a8a',
 *                        source: 'planning' } }],
 *     text: '…' }
 *
 * `source` records where the tagged text came from — the evaluator's own
 * script (the default, omitted from HTML) or a sentence lifted from the
 * teacher's Planning / Reflection answer. "The teacher says they
 * differentiate" and "the evaluator observed differentiation" are different
 * claims, and the PDF must let a reader tell them apart.
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
          const bg: unknown = attributes['bg'];
          if (!isHexColor(bg)) return {};
          return { 'data-bg': bg };
        },
      },
      fg: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-fg'),
        renderHTML: (attributes) => {
          const fg: unknown = attributes['fg'];
          if (!isHexColor(fg)) return {};
          return { 'data-fg': fg };
        },
      },
      source: {
        // Defaulting to 'script' keeps every tag written before this attr
        // existed rendering exactly as it did.
        default: 'script',
        parseHTML: (element) => element.getAttribute('data-source') ?? 'script',
        renderHTML: (attributes) => {
          const source = attributes['source'] as string | null;
          if (!source || source === 'script') return {};
          return { 'data-source': source };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mark[data-component-tag]' }];
  },

  renderHTML({ HTMLAttributes, mark }) {
    // bg/fg come from stored doc JSON that other users can write, so only a
    // strict #RRGGBB reaches the inline style. Anything else falls back to
    // the `[data-component-tag]` CSS default.
    const { bg, fg } = mark.attrs as { bg?: unknown; fg?: unknown };
    const styleParts: string[] = [];
    if (isHexColor(bg)) styleParts.push(`background-color:${bg}`);
    if (isHexColor(fg)) styleParts.push(`color:${fg}`);
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
