import { useEffect } from 'react';
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
import { Divider, ToolbarButton, insertOrEditLink } from './tiptap-toolbar';

const EMPTY_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

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
      onChange(ed.getJSON());
    },
    editorProps: {
      attributes: {
        class: 'tiptap-surface focus:outline-none px-3 py-2 text-sm',
      },
    },
  });

  // External value sync: if the parent passes new content (e.g. switching
  // between components or hydrating from Firestore), push it into the editor
  // without firing onUpdate to avoid an autosave loop.
  useEffect(() => {
    const incoming = value ?? EMPTY_DOC;
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
