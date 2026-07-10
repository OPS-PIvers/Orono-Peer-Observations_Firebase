import type { TiptapDoc, WorkProductAnswer } from '@ops/shared';

/** Empty Tiptap document — mirrors the editor's own EMPTY_DOC fallback. */
export const EMPTY_ANSWER_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Normalizes a stored work product answer to a Tiptap document for editing
 * or read-only rendering. Answers saved before the Tiptap upgrade are plain
 * strings; wrap them in a single paragraph so old data displays unchanged
 * and round-trips cleanly if the staff member edits it (at which point it's
 * saved back out as a Tiptap doc, same as any new answer).
 */
export function answerToTiptapDoc(answer: WorkProductAnswer['answer'] | undefined): TiptapDoc {
  if (answer == null) return EMPTY_ANSWER_DOC;
  if (typeof answer === 'string') {
    if (answer.trim() === '') return EMPTY_ANSWER_DOC;
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: answer }] }],
    };
  }
  return answer;
}
