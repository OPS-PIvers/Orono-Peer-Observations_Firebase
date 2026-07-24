import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Link as LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PromptDialog } from '@/components/PromptDialog';

/**
 * Shared low-level toolbar building blocks used by both `TiptapEditor` and
 * `ScriptEditor`. Kept intentionally small — presentational button + divider,
 * plus the link-editing behavior which both editors invoke identically.
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

/** Applies/removes the `link` mark on the current selection. */
function applyLink(editor: Editor, url: string) {
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}

/**
 * Shared "add/edit link" toolbar control: a `ToolbarButton` that opens a
 * `PromptDialog` (URL-validated via `toSafeUrl`) instead of `window.prompt()`.
 * Both `TiptapEditor` and `ScriptEditor` render the returned `button` inline
 * with their other toolbar buttons and the returned `dialog` alongside it.
 */
export function useLinkDialog(editor: Editor) {
  const [open, setOpen] = useState(false);

  const button = (
    <ToolbarButton
      active={editor.isActive('link')}
      onClick={() => setOpen(true)}
      title="Add/edit link"
      icon={<LinkIcon className="h-4 w-4" />}
    />
  );

  const dialog = (
    <PromptDialog
      open={open}
      onOpenChange={setOpen}
      title="Add/edit link"
      description="Leave blank and save to remove the link."
      fields={[
        {
          key: 'url',
          label: 'URL',
          defaultValue: (editor.getAttributes('link')['href'] as string | undefined) ?? 'https://',
          type: 'url',
        },
      ]}
      onConfirm={({ url }) => applyLink(editor, url ?? '')}
    />
  );

  return { button, dialog };
}
