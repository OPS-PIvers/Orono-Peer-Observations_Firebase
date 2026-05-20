import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Inline atom node representing a `{{variable}}` token in an email body.
 *
 * - In the editor it renders (via the node view) as a non-editable pill
 *   showing the friendly label, so non-technical admins never see raw braces.
 * - When serialized with `getHTML()` it emits
 *   `<span data-variable="x">{{x}}</span>`, which the body round-trip helper
 *   collapses back to a bare `{{x}}` token. The stored `bodyHtml` therefore
 *   stays byte-compatible with the existing send pipeline.
 */
export interface VariableTokenOptions {
  /** Map of variable key → human label, used only for in-editor display. */
  labels: Record<string, string>;
}

export const VariableToken = Node.create<VariableTokenOptions>({
  name: 'variableToken',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { labels: {} };
  },

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-variable') ?? '',
        renderHTML: (attributes) => {
          const name = attributes['name'] as string;
          return name ? { 'data-variable': name } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-variable]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = (node.attrs as { name: string }).name;
    return ['span', mergeAttributes(HTMLAttributes, { class: 'email-var-pill' }), `{{${name}}}`];
  },

  addNodeView() {
    const labels = this.options.labels;
    return ({ node }) => {
      const name = (node.attrs as { name: string }).name;
      const dom = document.createElement('span');
      dom.className = 'email-var-pill';
      dom.setAttribute('data-variable', name);
      dom.setAttribute('contenteditable', 'false');
      dom.textContent = labels[name] ?? name;
      dom.style.cssText =
        'display:inline-block;background:#eff6ff;color:#1d4ed8;border-radius:0.25rem;' +
        'padding:0 0.35em;font-size:0.85em;font-weight:500;white-space:nowrap;';
      return { dom };
    };
  },
});
