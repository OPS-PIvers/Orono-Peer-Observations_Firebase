/**
 * Conversions between the stored `bodyHtml` (bare `{{token}}` placeholders)
 * and the editor HTML (tokens wrapped in `<span data-variable>` so Tiptap
 * parses them into VariableToken pill nodes).
 *
 * Tokens that live inside HTML attributes (e.g. `href="{{signInLink}}"`) are
 * deliberately left untouched on the way in — only text-node tokens become
 * pills. Tiptap's Link extension preserves the attribute tokens across the
 * round-trip, so they still substitute at send time.
 */

const TOKEN_RE = /\{\{(\w+)\}\}/g;

/** bodyHtml → editor HTML: wrap text-node `{{token}}`s in pill spans. */
export function tokensToPillHtml(html: string): string {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;

  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.nodeValue;
    TOKEN_RE.lastIndex = 0;
    if (!TOKEN_RE.test(text)) continue;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    TOKEN_RE.lastIndex = 0;
    let match = TOKEN_RE.exec(text);
    while (match) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const span = document.createElement('span');
      span.setAttribute('data-variable', match[1] ?? '');
      frag.appendChild(span);
      lastIndex = match.index + match[0].length;
      match = TOKEN_RE.exec(text);
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return tpl.innerHTML;
}

/** editor HTML → bodyHtml: collapse pill spans back to bare `{{token}}`. */
export function pillsToTokenHtml(html: string): string {
  return html.replace(
    /<span[^>]*\bdata-variable=["']([^"']+)["'][^>]*>.*?<\/span>/gi,
    (_full, name: string) => `{{${name}}}`,
  );
}
