import { useEffect, useState } from 'react';
import { type Content, type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
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
  Tag as TagIcon,
  Undo2,
  X,
} from 'lucide-react';
import type { RubricComponent, RubricDomain, TiptapDoc } from '@ops/shared';
import { cn } from '@/lib/utils';
import { ComponentTagMark } from './component-tag-mark';

const EMPTY_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

export interface ScriptEditorProps {
  value: TiptapDoc | undefined;
  onChange: (document: TiptapDoc) => void;
  readOnly?: boolean;
  /** Components the script can be tagged against, in display order. */
  availableComponents: { domain: RubricDomain; component: RubricComponent }[];
  placeholder?: string;
  minHeight?: string;
}

/**
 * Tiptap-backed script editor. Same formatting tools as the per-component
 * notes editor, plus a "Tag" button that links the current selection (or
 * current paragraph if no selection) to a rubric component via a custom
 * mark. Tagged spans render with a tinted background per the CSS rule on
 * `mark[data-component-tag]`.
 */
export function ScriptEditor({
  value,
  onChange,
  readOnly = false,
  availableComponents,
  placeholder,
  minHeight = '0',
}: ScriptEditorProps) {
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
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getJSON());
    },
    editorProps: {
      attributes: { class: 'tiptap-surface focus:outline-none px-3 py-2 text-sm' },
    },
  });

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
        'border-input bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-md border',
        readOnly && 'opacity-70',
      )}
    >
      {!readOnly ? (
        <ScriptToolbar editor={editor} availableComponents={availableComponents} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto" style={{ minHeight }}>
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}

function ScriptToolbar({
  editor,
  availableComponents,
}: {
  editor: Editor;
  availableComponents: { domain: RubricDomain; component: RubricComponent }[];
}) {
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
      <ToolbarButton
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Quote"
        icon={<Quote className="h-4 w-4" />}
      />
      <Divider />
      <ToolbarButton
        active={editor.isActive('link')}
        onClick={() => insertOrEditLink(editor)}
        title="Add/edit link"
        icon={<LinkIcon className="h-4 w-4" />}
      />
      <Divider />
      <TagControl editor={editor} availableComponents={availableComponents} />
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

function TagControl({
  editor,
  availableComponents,
}: {
  editor: Editor;
  availableComponents: { domain: RubricDomain; component: RubricComponent }[];
}) {
  const [open, setOpen] = useState(false);
  // Force a rerender on each editor selection change so we can read the
  // active mark below. Tiptap fires `selectionUpdate` on every cursor move.
  const [, setTick] = useState(0);
  useEffect(() => {
    const handler = () => {
      setTick((n) => n + 1);
    };
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('transaction', handler);
    };
  }, [editor]);

  const activeTagId = editor.getAttributes('componentTag')['componentId'] as string | null;
  const activeLabel = activeTagId
    ? (availableComponents.find((ac) => ac.component.id === activeTagId)?.component.title ??
      activeTagId)
    : null;

  function applyTag(componentId: string) {
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      // No selection → tag the current paragraph's text.
      const paragraphRange = paragraphRangeAt(editor, from);
      if (paragraphRange) {
        editor
          .chain()
          .focus()
          .setTextSelection(paragraphRange)
          .setMark('componentTag', { componentId })
          .setTextSelection(from)
          .run();
      }
    } else {
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setMark('componentTag', { componentId })
        .run();
    }
    setOpen(false);
  }

  function clearTag() {
    editor.chain().focus().unsetMark('componentTag').run();
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={activeLabel ?? 'Tag selection to a rubric component'}
        className={cn(
          'hover:bg-accent hover:text-accent-foreground inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors',
          activeTagId && 'bg-accent text-accent-foreground',
        )}
      >
        <TagIcon className="h-4 w-4" />
        <span className="font-mono">{activeTagId ?? 'Tag'}</span>
      </button>
      {open ? (
        <div className="bg-background border-border absolute top-full left-0 z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border p-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">Tag with component</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {activeTagId ? (
            <button
              type="button"
              onClick={clearTag}
              className="text-destructive mb-2 block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-red-50"
            >
              Remove tag
            </button>
          ) : null}
          <ComponentPicker components={availableComponents} onPick={applyTag} />
        </div>
      ) : null}
    </div>
  );
}

function ComponentPicker({
  components,
  onPick,
}: {
  components: { domain: RubricDomain; component: RubricComponent }[];
  onPick: (componentId: string) => void;
}) {
  const grouped = new Map<string, { domain: RubricDomain; components: RubricComponent[] }>();
  for (const { domain, component } of components) {
    let g = grouped.get(domain.id);
    if (!g) {
      g = { domain, components: [] };
      grouped.set(domain.id, g);
    }
    g.components.push(component);
  }
  if (grouped.size === 0) {
    return (
      <p className="text-muted-foreground px-2 py-3 text-xs">
        No components are assigned for this role/year.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {Array.from(grouped.values()).map(({ domain, components: comps }) => (
        <li key={domain.id}>
          <p className="text-muted-foreground px-2 py-1 text-[10px] font-semibold uppercase">
            Domain {domain.id}: {domain.name}
          </p>
          <ul className="space-y-0.5">
            {comps.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick(c.id)}
                  className="hover:bg-accent hover:text-accent-foreground block w-full rounded-md px-2 py-1 text-left text-xs"
                >
                  <span className="font-mono opacity-70">{c.id}</span> {c.title}
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
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

/**
 * Find the {from, to} range covering the paragraph containing `pos`.
 * Returns null when the cursor isn't inside a textblock (e.g. doc start).
 */
function paragraphRangeAt(editor: Editor, pos: number): { from: number; to: number } | null {
  const $pos = editor.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.isTextblock) {
      const from = $pos.start(depth);
      const to = $pos.end(depth);
      return { from, to };
    }
  }
  return null;
}
