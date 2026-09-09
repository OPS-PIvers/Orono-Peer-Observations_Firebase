import type { TagSource } from './extract-script-tags';

/** Human label for where a tagged span came from, keyed by `TagSource`. */
export const TAG_SOURCE_LABEL: Record<TagSource, string> = {
  script: 'Script',
  planning: "Teacher's Planning response",
  reflection: "Teacher's Reflection response",
};

interface TextNode {
  type: 'text';
  text: string;
  marks?: { type: string }[];
}

interface ParagraphNode {
  type: 'paragraph';
  content: TextNode[];
}

/**
 * The nodes appended to the script when the evaluator captures a sentence
 * from a teacher's Planning / Reflection answer as evidence: an italic
 * attribution line, then the captured text as its own paragraph so the
 * caller can select exactly that paragraph and tag it.
 *
 * The attribution stays a separate paragraph on purpose. Only the tagged
 * text travels into the per-component "From script" view and the PDF; the
 * provenance that matters there rides on the `componentTag` mark's
 * `source` attr instead (see extract-script-tags.ts). This line is for a
 * reader of the raw script.
 *
 * Pure: builds fresh nodes, never touches an existing doc.
 */
export function buildTeacherResponseNodes(
  text: string,
  source: Exclude<TagSource, 'script'>,
  questionText: string,
): ParagraphNode[] {
  const quote = text.trim();
  const question = questionText.trim();
  const attribution = question
    ? `${TAG_SOURCE_LABEL[source]} — “${question}”`
    : TAG_SOURCE_LABEL[source];
  return [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: attribution, marks: [{ type: 'italic' }] }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: quote }] },
  ];
}
