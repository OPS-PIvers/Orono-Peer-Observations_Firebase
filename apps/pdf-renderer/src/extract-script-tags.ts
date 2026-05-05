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
 * PDF-renderer mirror of apps/web/src/observations/extract-script-tags.ts.
 * Kept identical so the on-screen "Script tags" view and the printed PDF
 * agree on which spans appear under each component.
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
