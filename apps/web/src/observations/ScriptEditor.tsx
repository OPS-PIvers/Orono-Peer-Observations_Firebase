import { useEffect, useState } from 'react';
import { type Content, type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { httpsCallable } from 'firebase/functions';
import {
  Bold,
  Check,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  Tag as TagIcon,
  Undo2,
  X,
} from 'lucide-react';
import type { RubricComponent, RubricDomain, TiptapDoc } from '@ops/shared';
import { cn } from '@/lib/utils';
import { functions } from '@/lib/firebase';
import { ComponentTagMark } from './component-tag-mark';
import { colorFor } from './component-colors';

const EMPTY_DOC: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

const geminiTagScriptFn = httpsCallable<
  { observationId: string },
  { taggedCount: number; skippedCount: number }
>(functions, 'geminiTagScript');

export interface ScriptEditorProps {
  value: TiptapDoc | undefined;
  onChange: (document: TiptapDoc) => void;
  readOnly?: boolean;
  /** Components the script can be tagged against, in display order. */
  availableComponents: { domain: RubricDomain; component: RubricComponent }[];
  /** Observation id, required for the Auto-tag callable. Omit to hide the button. */
  observationId?: string;
  placeholder?: string;
  minHeight?: string;
}

/**
 * Tiptap-backed script editor. Same formatting tools as the per-component
 * notes editor, plus a "Tag" button that opens a side panel of component
 * buttons. Selecting text and clicking a button applies a `componentTag`
 * mark with the component's bg/fg colors. The panel stays open until the
 * Tag button is toggled off.
 */
export function ScriptEditor({
  value,
  onChange,
  readOnly = false,
  availableComponents,
  observationId,
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

  // Force a rerender on each editor selection change so we can read the
  // active mark from anywhere in this component tree.
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

  const [pickerOpen, setPickerOpen] = useState(false);
  const [autoTagBusy, setAutoTagBusy] = useState(false);
  const [autoTagError, setAutoTagError] = useState<string | null>(null);
  const [autoTagResult, setAutoTagResult] = useState<{
    taggedCount: number;
    skippedCount: number;
  } | null>(null);

  const activeTagId = editor.getAttributes('componentTag')['componentId'] as string | null;

  function applyTag(component: RubricComponent) {
    const { bg, fg } = colorFor(component);
    const attrs = { componentId: component.id, bg, fg };
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const paragraphRange = paragraphRangeAt(editor, from);
      if (paragraphRange) {
        editor
          .chain()
          .focus()
          .setTextSelection(paragraphRange)
          .setMark('componentTag', attrs)
          .setTextSelection(from)
          .run();
      }
    } else {
      editor.chain().focus().setTextSelection({ from, to }).setMark('componentTag', attrs).run();
    }
  }

  function clearTag() {
    editor.chain().focus().unsetMark('componentTag').run();
  }

  async function runAutoTag() {
    if (!observationId) return;
    setAutoTagBusy(true);
    setAutoTagError(null);
    setAutoTagResult(null);
    try {
      const res = await geminiTagScriptFn({ observationId });
      setAutoTagResult(res.data);
    } catch (err) {
      setAutoTagError(err instanceof Error ? err.message : 'Auto-tag failed');
    } finally {
      setAutoTagBusy(false);
    }
  }

  return (
    <div
      className={cn(
        'border-input bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-md border',
        readOnly && 'opacity-70',
      )}
    >
      {!readOnly ? (
        <ScriptToolbar
          editor={editor}
          activeTagId={activeTagId}
          pickerOpen={pickerOpen}
          onTogglePicker={() => setPickerOpen((v) => !v)}
          onAutoTag={observationId ? () => void runAutoTag() : null}
          autoTagBusy={autoTagBusy}
        />
      ) : null}
      {autoTagError ? (
        <div className="bg-ops-red-lighter text-ops-red-dark border-b border-red-200 px-3 py-1.5 text-xs">
          Auto-tag failed: {autoTagError}
        </div>
      ) : null}
      {autoTagResult ? (
        <div className="bg-accent text-accent-foreground border-b px-3 py-1.5 text-xs">
          Gemini tagged {autoTagResult.taggedCount} span
          {autoTagResult.taggedCount === 1 ? '' : 's'}
          {autoTagResult.skippedCount > 0
            ? ` (${String(autoTagResult.skippedCount)} skipped — couldn't locate verbatim text)`
            : ''}
          .
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div
          className="min-h-0 flex-1 overflow-auto"
          style={minHeight !== '0' ? { minHeight } : undefined}
        >
          <EditorContent editor={editor} className="h-full" />
        </div>
        {pickerOpen && !readOnly ? (
          <ComponentSidePanel
            components={availableComponents}
            activeTagId={activeTagId}
            onPick={applyTag}
            onClear={clearTag}
            onClose={() => setPickerOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ScriptToolbar({
  editor,
  activeTagId,
  pickerOpen,
  onTogglePicker,
  onAutoTag,
  autoTagBusy,
}: {
  editor: Editor;
  activeTagId: string | null;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onAutoTag: (() => void) | null;
  autoTagBusy: boolean;
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
      <button
        type="button"
        onClick={onTogglePicker}
        title={pickerOpen ? 'Close component picker' : 'Tag selection to a rubric component'}
        aria-pressed={pickerOpen}
        className={cn(
          'hover:bg-accent hover:text-accent-foreground inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors',
          pickerOpen && 'bg-accent text-accent-foreground',
          activeTagId && !pickerOpen && 'text-ops-blue-dark',
        )}
      >
        <TagIcon className="h-4 w-4" />
        <span className="font-mono">{activeTagId ?? 'Tag'}</span>
      </button>
      {onAutoTag ? (
        <button
          type="button"
          onClick={onAutoTag}
          disabled={autoTagBusy}
          title="Auto-tag the script with Gemini"
          className={cn(
            'hover:bg-accent hover:text-accent-foreground inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors',
            autoTagBusy && 'cursor-not-allowed opacity-50',
          )}
        >
          <Sparkles className={cn('h-4 w-4', autoTagBusy && 'animate-pulse')} />
          <span>{autoTagBusy ? 'Tagging…' : 'Auto-tag'}</span>
        </button>
      ) : null}
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

/**
 * Side panel rendered to the right of the editor body. Lists every
 * component as a colored button — clicking one applies the tag to the
 * editor's current selection (or current paragraph if empty). The panel
 * stays open until the Tag toolbar button is toggled off so observers can
 * tag many spans in succession without reopening a menu.
 */
function ComponentSidePanel({
  components,
  activeTagId,
  onPick,
  onClear,
  onClose,
}: {
  components: { domain: RubricDomain; component: RubricComponent }[];
  activeTagId: string | null;
  onPick: (component: RubricComponent) => void;
  onClear: () => void;
  onClose: () => void;
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

  return (
    // preventDefault on mousedown so clicking the panel doesn't blur the
    // editor and collapse the user's text selection before they pick.
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
    <div
      role="region"
      aria-label="Component picker"
      className="bg-background flex w-60 shrink-0 flex-col overflow-y-auto border-l"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName !== 'BUTTON') e.preventDefault();
      }}
    >
      <div className="bg-muted/40 sticky top-0 flex items-center justify-between border-b px-3 py-2">
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          Tag with component
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close component picker"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {activeTagId ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          className="text-destructive border-b px-3 py-1.5 text-left text-xs hover:bg-red-50"
        >
          Remove tag from selection
        </button>
      ) : null}

      {grouped.size === 0 ? (
        <p className="text-muted-foreground px-3 py-3 text-xs">
          No components are assigned for this role/year.
        </p>
      ) : (
        <ul className="space-y-2 p-2">
          {Array.from(grouped.values()).map(({ domain, components: comps }) => (
            <li key={domain.id}>
              <p className="text-muted-foreground px-1 py-1 text-[10px] font-semibold uppercase">
                Domain {domain.id}: {domain.name}
              </p>
              <ul className="space-y-1">
                {comps.map((c) => {
                  const { bg, fg } = colorFor(c);
                  const isActive = activeTagId === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => onPick(c)}
                        title={`Tag selection as ${c.id} — ${c.title}`}
                        style={{ backgroundColor: bg, color: fg }}
                        className={cn(
                          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs leading-tight transition-shadow hover:shadow-md',
                          isActive && 'ring-ops-blue-dark ring-2 ring-offset-1',
                        )}
                      >
                        {isActive ? (
                          <Check className="h-3 w-3 shrink-0" />
                        ) : (
                          <span className="font-mono opacity-70">{c.id}</span>
                        )}
                        <span className="truncate font-medium">{c.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
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
