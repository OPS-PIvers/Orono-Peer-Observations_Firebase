import type { Editor } from '@tiptap/core';

/**
 * Removes the component tag the observer is pointing at.
 *
 * With a bare cursor inside a tag, the whole tagged segment is cleared, not
 * just the empty range at the caret. A real selection still clears only what
 * is selected, so part of a tag can be trimmed off.
 */
export function clearComponentTag(editor: Editor): void {
  const { from, empty } = editor.state.selection;
  const componentId = editor.getAttributes('componentTag')['componentId'] as string | null;
  if (empty && componentId) {
    editor
      .chain()
      .focus()
      .extendMarkRange('componentTag', { componentId })
      .unsetMark('componentTag')
      .setTextSelection(from)
      .run();
    return;
  }
  editor.chain().focus().unsetMark('componentTag').run();
}
