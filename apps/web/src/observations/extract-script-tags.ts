import type { TiptapDoc } from '@ops/shared';

export interface TaggedSpan {
  text: string;
  paragraphIndex: number;
  bg: string | null;
  fg: string | null;
}

interface MaybeNode {
  type?: string;
  text?: string;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: unknown[];
}

function isTextblockType(type: string): boolean {
  return type === 'paragraph' || type === 'heading' || type === 'blockquote' || type === 'listItem';
}

/**
 * Walks a Tiptap doc and returns every text run that carries a
 * `componentTag` mark with the matching `componentId`. Adjacent runs in the
 * same paragraph are joined so the mirrored notes view shows continuous
 * highlighted phrases instead of fragmented per-mark slices.
 */
export function extractTaggedSpansForComponent(
  scriptDoc: TiptapDoc | undefined,
  componentId: string,
): TaggedSpan[] {
  if (!scriptDoc) return [];
  const out: TaggedSpan[] = [];
  let paragraphIndex = -1;
  let currentParagraphHadMatch = false;

  function visit(node: MaybeNode | null | undefined): void {
    if (!node || typeof node !== 'object') return;

    if (typeof node.type === 'string' && isTextblockType(node.type)) {
      paragraphIndex += 1;
      currentParagraphHadMatch = false;
    }

    if (node.type === 'text' && typeof node.text === 'string') {
      const tagMark = node.marks?.find((m) => m.type === 'componentTag');
      if (
        tagMark &&
        (tagMark.attrs as { componentId?: string } | undefined)?.componentId === componentId
      ) {
        const attrs = tagMark.attrs as { bg?: string | null; fg?: string | null } | undefined;
        const last = out[out.length - 1];
        if (currentParagraphHadMatch && last?.paragraphIndex === paragraphIndex) {
          last.text += node.text;
        } else {
          out.push({
            text: node.text,
            paragraphIndex,
            bg: attrs?.bg ?? null,
            fg: attrs?.fg ?? null,
          });
          currentParagraphHadMatch = true;
        }
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(child as MaybeNode);
      }
    }
  }

  visit(scriptDoc);
  return out;
}

/**
 * Build a read-only Tiptap doc that mirrors the tagged spans for a given
 * component. Each span becomes its own paragraph carrying the same
 * `componentTag` mark so the existing CSS / inline-style rules render the
 * correct highlight color in the read-only `TiptapEditor` mount.
 */
export function buildScriptNotesDoc(spans: TaggedSpan[], componentId: string): TiptapDoc {
  if (spans.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return {
    type: 'doc',
    content: spans.map((span) => ({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: span.text,
          marks: [
            {
              type: 'componentTag',
              attrs: {
                componentId,
                bg: span.bg,
                fg: span.fg,
              },
            },
          ],
        },
      ],
    })),
  };
}
