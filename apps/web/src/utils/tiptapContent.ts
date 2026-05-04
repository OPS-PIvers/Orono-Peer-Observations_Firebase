import type { TiptapDoc } from '@ops/shared';

/**
 * True iff `doc` contains at least one non-empty text node anywhere in the
 * tree. Used to decide whether a Tiptap-backed editor is "empty" for the
 * purpose of auto-expanding hidden surfaces (rubric notes, meeting notes).
 *
 * An empty paragraph (no children, or only whitespace text) returns false.
 */
export function hasTiptapContent(doc: TiptapDoc | undefined): boolean {
  return walkForText(doc);
}

function walkForText(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (n.type === 'text' && typeof n.text === 'string' && n.text.trim() !== '') return true;
  if (Array.isArray(n.content)) return n.content.some(walkForText);
  return false;
}
