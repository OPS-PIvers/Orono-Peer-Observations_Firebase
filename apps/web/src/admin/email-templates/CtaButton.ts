import { Node, mergeAttributes } from '@tiptap/core';
import { EMAIL_BUTTON_STYLE } from '@ops/shared';

/**
 * Inline atom node for a call-to-action button in an email body.
 *
 * Serializes (getHTML) to an email-safe styled anchor
 * `<a href="…" data-cta="true" style="…">Label</a>` — the same markup the
 * seeded templates use — so the stored bodyHtml stays send-ready and the
 * variable round-trip (which only touches text tokens and pill spans) leaves
 * it alone. In the editor it renders as a clickable button pill.
 */
export const CtaButton = Node.create({
  name: 'ctaButton',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  priority: 60, // win over the Link mark for `a[data-cta]`

  addAttributes() {
    return {
      href: {
        default: '#',
        parseHTML: (el) => el.getAttribute('href') ?? '#',
        renderHTML: (attrs) => ({ href: (attrs['href'] as string) || '#' }),
      },
      label: {
        default: 'Button',
        parseHTML: (el) => el.textContent || 'Button',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-cta]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = (node.attrs as { label: string }).label;
    return [
      'a',
      mergeAttributes(HTMLAttributes, { 'data-cta': 'true', style: EMAIL_BUTTON_STYLE }),
      label,
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const attrs = node.attrs as { href: string; label: string };
      const dom = document.createElement('span');
      dom.className = 'email-cta-pill';
      dom.textContent = attrs.label;
      dom.setAttribute('contenteditable', 'false');
      dom.title = `Button → ${attrs.href}`;
      dom.style.cssText = EMAIL_BUTTON_STYLE + 'cursor:pointer;';
      return { dom };
    };
  },
});
