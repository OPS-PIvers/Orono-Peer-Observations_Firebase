import type { TiptapDoc } from '@ops/shared';

interface MaybeNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
}

/**
 * True when the doc is missing or contains no actual text — e.g. Tiptap's
 * pristine empty state (`{ type: 'doc', content: [{ type: 'paragraph' }] }`).
 * Used so inserting a transcript into an untouched script doesn't leave a
 * stray blank paragraph above the heading.
 */
export function isScriptDocEmpty(scriptDoc: TiptapDoc | undefined): boolean {
  if (!scriptDoc) return true;
  let hasText = false;
  function visit(node: MaybeNode | null | undefined): void {
    if (!node || typeof node !== 'object' || hasText) return;
    if (node.type === 'text' && typeof node.text === 'string' && node.text.trim().length > 0) {
      hasText = true;
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child as MaybeNode);
    }
  }
  visit(scriptDoc);
  return !hasText;
}

/**
 * Append a completed audio transcript to the observation's script doc as
 * Tiptap-compatible content: a level-3 heading delimiter (`label`, e.g.
 * "Transcript — Recording 2") followed by one paragraph per transcript
 * line. Paragraph blocks (not a code/quote island) so the result flows
 * through the same pipeline as hand-typed script text — `geminiTagScript`
 * extracts textblocks for auto-tagging and the PDF renderer walks the same
 * shapes.
 *
 * Pure function: never mutates the input doc.
 */
export function appendTranscriptToScriptDoc(
  scriptDoc: TiptapDoc | undefined,
  transcript: string,
  label: string,
): TiptapDoc {
  const lines = transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const inserted: MaybeNode[] = [
    {
      type: 'heading',
      // Level 3 matches ScriptEditor's StarterKit config (heading levels 2–3).
      attrs: { level: 3 },
      content: [{ type: 'text', text: label }],
    },
    ...lines.map((line) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    })),
  ];

  const existing = isScriptDocEmpty(scriptDoc) ? [] : (scriptDoc?.content ?? []);
  return { type: 'doc', content: [...existing, ...inserted] };
}
