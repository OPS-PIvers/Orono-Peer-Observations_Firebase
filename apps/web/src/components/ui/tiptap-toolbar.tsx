import type { Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';

/**
 * Shared low-level toolbar building blocks used by both `TiptapEditor` and
 * `ScriptEditor`. Kept intentionally small — presentational button + divider,
 * plus the link-prompt behavior which both editors invoke identically.
 */

export function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  icon,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        'hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        active && 'bg-accent text-accent-foreground',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {icon}
    </button>
  );
}

export function Divider() {
  return <span className="bg-border mx-1 h-5 w-px" />;
}

/**
 * Prompts the user for a URL and applies/removes the `link` mark on the
 * current selection. Encapsulated here as a single exported function so the
 * prompting mechanism (currently `window.prompt`) can be swapped for a
 * dialog in one place.
 */
export function insertOrEditLink(editor: Editor) {
  const previous = editor.getAttributes('link')['href'] as string | undefined;
  const url = window.prompt('URL', previous ?? 'https://');
  if (url === null) return;
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}
