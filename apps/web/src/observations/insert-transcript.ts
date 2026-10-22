import type { TiptapDoc, TranscriptSummary } from '@ops/shared';

interface MaybeNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: unknown[];
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

/**
 * Append a condensed transcript ("Send to script" → assigned-domain evidence
 * or custom focus) under a level-3 `label` heading: the lesson summary, then
 * per section a bold heading with what was noticed and a bullet per piece of
 * evidence, then the reflection questions.
 *
 * Evidence in a component section is tagged with that component (same mark
 * and colors as a hand-applied tag), so it shows on the rubric and in the PDF
 * without an auto-tag pass. The timestamp stays outside the tag.
 *
 * Pure function: never mutates the input doc.
 */
export function appendTranscriptSummaryToScriptDoc(
  scriptDoc: TiptapDoc | undefined,
  summary: TranscriptSummary,
  label: string,
): TiptapDoc {
  const colors = new Map(summary.components.map((c) => [c.componentId, c]));
  const text = (value: string, marks?: unknown[]): MaybeNode =>
    marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
  const bold = (value: string) => text(value, [{ type: 'bold' }]);
  const paragraph = (...content: MaybeNode[]): MaybeNode => ({ type: 'paragraph', content });
  const listItem = (...content: MaybeNode[]): MaybeNode => ({
    type: 'listItem',
    content: [paragraph(...content)],
  });

  const inserted: MaybeNode[] = [{ type: 'heading', attrs: { level: 3 }, content: [text(label)] }];
  if (summary.focus) inserted.push(paragraph(bold('Focus. '), text(summary.focus)));
  if (summary.summary) inserted.push(paragraph(bold('Summary. '), text(summary.summary)));

  for (const section of summary.sections) {
    const title = section.componentId
      ? `${section.componentId} ${section.heading}`.trim()
      : section.heading;
    const head: MaybeNode[] = [];
    if (title) head.push(bold(section.noticed ? `${title}. ` : title));
    if (section.noticed) head.push(text(section.noticed));
    if (head.length > 0) inserted.push(paragraph(...head));

    const color = section.componentId ? colors.get(section.componentId) : undefined;
    const tag =
      section.componentId !== null
        ? [
            {
              type: 'componentTag',
              attrs: {
                componentId: section.componentId,
                bg: color?.bg ?? null,
                fg: color?.fg ?? null,
                source: 'script',
              },
            },
          ]
        : undefined;
    if (section.evidence.length > 0) {
      inserted.push({
        type: 'bulletList',
        content: section.evidence.map((e) =>
          e.time ? listItem(text(`[${e.time}] `), text(e.text, tag)) : listItem(text(e.text, tag)),
        ),
      });
    }
  }

  if (summary.reflectionQuestions.length > 0) {
    inserted.push(paragraph(bold('Reflection questions')));
    inserted.push({
      type: 'orderedList',
      content: summary.reflectionQuestions.map((q) => listItem(text(q))),
    });
  }

  const existing = isScriptDocEmpty(scriptDoc) ? [] : (scriptDoc?.content ?? []);
  return { type: 'doc', content: [...existing, ...inserted] };
}
