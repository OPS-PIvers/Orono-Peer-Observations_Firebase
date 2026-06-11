import { useEffect, useRef } from 'react';
import { type Content, type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { ComponentTagMark } from '@/observations/component-tag-mark';
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react';
import type { TiptapDoc } from '@ops/shared';
import { cn } from '@/lib/utils';

const EMPTY_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Hosts approved for rich-text media embeds (YouTube video + Google Drive
 * shares). Any embed URL whose host is outside this allowlist is rejected
 * before it reaches the editor, so a pasted link can't smuggle in an arbitrary
 * third-party iframe. Kept deliberately narrow — generic video platforms
 * (Vimeo, Dailymotion, TikTok, …) are intentionally excluded.
 */
export const ALLOWED_EMBED_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'drive.google.com',
] as const;

export interface TiptapEditorProps {
  value: TiptapDoc | undefined;
  onChange: (doc: TiptapDoc) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  /** Compact = inline tools only; full = also includes block-level (heading, list, quote). */
  variant?: 'compact' | 'full';
  /** Minimum visible editor area in CSS units. */
  minHeight?: string;
  /** Auto-focus the editor on mount. */
  autoFocus?: boolean;
}

/**
 * Reusable rich-text editor backed by Tiptap. Stores content as Tiptap JSON
 * matching the `tiptapDoc` schema in `@ops/shared`. The component is a
 * controlled wrapper — pass `value` + `onChange` to integrate with autosave.
 *
 * The editor reconciles externally-driven `value` changes (e.g., when the
 * parent switches between rubric components) by calling `setContent` with
 * `emitUpdate: false` so the sync doesn't loop back through onChange.
 */
export function TiptapEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  className,
  variant = 'compact',
  minHeight = '8rem',
  autoFocus = false,
}: TiptapEditorProps) {
  // Tracks the exact doc object we last emitted via onChange. The parent
  // stores it and feeds it straight back as `value`, so a reference match
  // lets the sync effect skip re-serialising the whole document on every
  // keystroke.
  const lastEmittedRef = useRef<TiptapDoc | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      ComponentTagMark,
    ],
    content: (value ?? EMPTY_DOC) as Content,
    editable: !readOnly,
    autofocus: autoFocus,
    onUpdate: ({ editor: ed }) => {
      const json: TiptapDoc = ed.getJSON();
      lastEmittedRef.current = json;
      onChange(json);
    },
    editorProps: {
      attributes: {
        class: 'tiptap-surface focus:outline-none px-3 py-2 text-sm',
      },
    },
  });

  // External value sync: if the parent passes new content (e.g. switching
  // between components or hydrating from Firestore), push it into the editor
  // without firing onUpdate to avoid an autosave loop. The reference check
  // short-circuits self-originated updates (the common per-keystroke case)
  // so we only stringify-compare for genuinely external changes.
  useEffect(() => {
    const incoming = value ?? EMPTY_DOC;
    if (incoming === lastEmittedRef.current) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) === JSON.stringify(incoming)) return;
    editor.commands.setContent(incoming as Content, { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <div
      className={cn(
        'border-input bg-background overflow-hidden rounded-md border',
        readOnly && 'opacity-70',
        className,
      )}
    >
      {!readOnly ? <Toolbar editor={editor} variant={variant} /> : null}
      <div style={{ minHeight }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor, variant }: { editor: Editor; variant: 'compact' | 'full' }) {
  return (
    <div className="border-input bg-muted/40 flex flex-wrap items-center gap-1 border-b px-2 py-1">
      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold (Ctrl+B)"
        icon={<Bold className="h-4 w-4" />}
      />
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
        icon={<Italic className="h-4 w-4" />}
      />
      <ToolbarButton
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
        icon={<Strikethrough className="h-4 w-4" />}
      />

      {variant === 'full' ? (
        <>
          <Divider />
          <ToolbarButton
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading 2"
            icon={<Heading2 className="h-4 w-4" />}
          />
          <ToolbarButton
            active={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="Heading 3"
            icon={<Heading3 className="h-4 w-4" />}
          />
        </>
      ) : null}

      <Divider />
      <ToolbarButton
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
        icon={<List className="h-4 w-4" />}
      />
      <ToolbarButton
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
        icon={<ListOrdered className="h-4 w-4" />}
      />
      {variant === 'full' ? (
        <ToolbarButton
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Quote"
          icon={<Quote className="h-4 w-4" />}
        />
      ) : null}

      <Divider />
      <ToolbarButton
        active={editor.isActive('link')}
        onClick={() => insertOrEditLink(editor)}
        title="Add/edit link"
        icon={<LinkIcon className="h-4 w-4" />}
      />

      <div className="ml-auto flex items-center gap-1">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().chain().focus().undo().run()}
          title="Undo (Ctrl+Z)"
          icon={<Undo2 className="h-4 w-4" />}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().chain().focus().redo().run()}
          title="Redo (Ctrl+Shift+Z)"
          icon={<Redo2 className="h-4 w-4" />}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
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

function Divider() {
  return <span className="bg-border mx-1 h-5 w-px" />;
}

function insertOrEditLink(editor: Editor) {
  const previous = editor.getAttributes('link')['href'] as string | undefined;
  const url = window.prompt('URL', previous ?? 'https://');
  if (url === null) return;
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
}
