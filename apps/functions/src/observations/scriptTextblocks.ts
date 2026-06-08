import type { ComponentColor, TiptapDoc } from '@ops/shared';

/**
 * Shared Tiptap-doc traversal for the Gemini script auto-tagger.
 *
 * The tagger asks Gemini to return tags keyed by paragraph index, then applies
 * them back to the script doc. The index-producing pass (`extractParagraphs`)
 * and the index-consuming pass (`applyTagsToScriptDoc`) MUST enumerate the
 * doc's textblocks identically, or a tag lands on the wrong block. They share
 * one rule, implemented here once:
 *
 *   Visit textblocks in document order. One textblock = one index. Never
 *   recurse into a textblock's children.
 *
 * A "textblock" is a leaf block that directly holds inline (taggable) text:
 * `paragraph` and `heading`. Container blocks (bulletList, orderedList,
 * listItem, blockquote, …) are recursed THROUGH, not counted — so a script
 * with lists or blockquotes still maps Gemini's indices to the right block.
 */

export interface MaybeNode {
  type?: string;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: unknown[];
}

export interface RawTagSuggestion {
  paragraphIndex: number;
  text: string;
  componentId: string;
}

/** Leaf block types that directly contain inline (taggable) text. */
function isTextblockType(type: string): boolean {
  return type === 'paragraph' || type === 'heading';
}

/** Visit each leaf textblock node once, in document order. */
function eachTextblock(
  node: MaybeNode | null | undefined,
  visit: (block: MaybeNode) => void,
): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string' && isTextblockType(node.type)) {
    visit(node);
    return; // one textblock = one index; never descend into its children
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) eachTextblock(child as MaybeNode, visit);
  }
}

/** Concatenate all inline text under a textblock node. */
function collectInlineText(node: MaybeNode): string {
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  let s = '';
  if (Array.isArray(node.content)) {
    for (const child of node.content) s += collectInlineText(child as MaybeNode);
  }
  return s;
}

/** Flatten the doc into one string per textblock, in document order. */
export function extractParagraphs(scriptDoc: TiptapDoc): string[] {
  const out: string[] = [];
  eachTextblock(scriptDoc, (block) => out.push(collectInlineText(block)));
  return out;
}

/**
 * Walk the doc and apply `componentTag` marks to every accepted suggestion.
 * For each suggestion we find the first occurrence of `text` inside the
 * textblock at `paragraphIndex` and split surrounding text nodes so the mark
 * applies to exactly that range. Existing marks on the matched text are
 * preserved; we only add or replace the `componentTag` mark.
 */
export function applyTagsToScriptDoc(
  doc: TiptapDoc,
  suggestions: RawTagSuggestion[],
  colorMap: Map<string, ComponentColor>,
): TiptapDoc {
  // Group suggestions by paragraph to apply them in a single pass per block.
  const byParagraph = new Map<number, RawTagSuggestion[]>();
  for (const s of suggestions) {
    const list = byParagraph.get(s.paragraphIndex) ?? [];
    list.push(s);
    byParagraph.set(s.paragraphIndex, list);
  }

  // Map each textblock node (by identity, in the SAME document order
  // extractParagraphs uses) to its tagged content. The rebuild below then
  // swaps each block's content in place, so indices can never drift.
  const replacement = new Map<MaybeNode, MaybeNode[]>();
  let index = -1;
  eachTextblock(doc, (block) => {
    index += 1;
    const localTags = byParagraph.get(index) ?? [];
    replacement.set(
      block,
      applyTagsWithinParagraph((block.content ?? []) as MaybeNode[], localTags, colorMap),
    );
  });

  function rebuild(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const node = input as MaybeNode;
    if (typeof node.type === 'string' && isTextblockType(node.type)) {
      const newContent = replacement.get(node);
      return newContent ? { ...node, content: newContent } : node;
    }
    if (Array.isArray(node.content)) {
      return { ...node, content: (node.content as MaybeNode[]).map((c) => rebuild(c)) };
    }
    return node;
  }

  return rebuild(doc) as TiptapDoc;
}

function applyTagsWithinParagraph(
  content: MaybeNode[],
  tags: RawTagSuggestion[],
  colorMap: Map<string, ComponentColor>,
): MaybeNode[] {
  // Build a flat representation of the paragraph: { text, marks } per text
  // node. Nested non-text nodes are kept as-is and treated as opaque
  // separators (they can't be split for tagging).
  let working = [...content];
  for (const tag of tags) {
    const color = colorMap.get(tag.componentId);
    working = applySingleTag(working, tag.text, tag.componentId, color);
  }
  return working;
}

function applySingleTag(
  content: MaybeNode[],
  needle: string,
  componentId: string,
  color: ComponentColor | undefined,
): MaybeNode[] {
  // Concatenate adjacent text nodes' text to find the needle's position.
  // Mark each text node with its (start, end) offset in the paragraph
  // string so we can split the right one(s).
  interface TextSlot {
    kind: 'text';
    node: MaybeNode;
    text: string;
    start: number;
    end: number;
  }
  interface OtherSlot {
    kind: 'other';
    node: MaybeNode;
  }
  const slots: (TextSlot | OtherSlot)[] = [];
  let cursor = 0;
  for (const c of content) {
    if (c.type === 'text' && typeof c.text === 'string') {
      slots.push({
        kind: 'text',
        node: c,
        text: c.text,
        start: cursor,
        end: cursor + c.text.length,
      });
      cursor += c.text.length;
    } else {
      slots.push({ kind: 'other', node: c });
    }
  }
  const flat = slots
    .filter((s): s is TextSlot => s.kind === 'text')
    .map((s) => s.text)
    .join('');
  const matchStart = flat.indexOf(needle);
  if (matchStart < 0) return content;
  const matchEnd = matchStart + needle.length;

  const out: MaybeNode[] = [];
  for (const slot of slots) {
    if (slot.kind === 'other') {
      out.push(slot.node);
      continue;
    }
    if (slot.end <= matchStart || slot.start >= matchEnd) {
      out.push(slot.node);
      continue;
    }
    // This slot overlaps the match. Split into up to three pieces.
    const overlapStart = Math.max(slot.start, matchStart) - slot.start;
    const overlapEnd = Math.min(slot.end, matchEnd) - slot.start;
    const before = slot.text.slice(0, overlapStart);
    const middle = slot.text.slice(overlapStart, overlapEnd);
    const after = slot.text.slice(overlapEnd);
    const baseMarks = (slot.node.marks ?? []).filter((m) => m.type !== 'componentTag');
    const tagMark: { type: string; attrs: Record<string, unknown> } = {
      type: 'componentTag',
      attrs: {
        componentId,
        bg: color?.bg ?? null,
        fg: color?.fg ?? null,
      },
    };
    if (before.length > 0) {
      out.push({ ...slot.node, text: before, marks: baseMarks });
    }
    out.push({ ...slot.node, text: middle, marks: [...baseMarks, tagMark] });
    if (after.length > 0) {
      out.push({ ...slot.node, text: after, marks: baseMarks });
    }
  }
  return out;
}
