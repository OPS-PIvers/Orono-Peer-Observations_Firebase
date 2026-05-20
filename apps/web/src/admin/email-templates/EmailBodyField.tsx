import { useRef, useState } from 'react';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Code2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MousePointerClick,
  PenLine,
} from 'lucide-react';
import type { TemplateVariable } from '@ops/shared';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CtaButton } from './CtaButton';
import { VariableToken } from './VariableToken';
import { VARIABLE_LABELS, variableLabel } from './variableLabels';
import { pillsToTokenHtml, tokensToPillHtml } from './emailBodyHtml';

export interface EmailBodyFieldProps {
  value: string;
  onChange: (bodyHtml: string) => void;
  variables: TemplateVariable[];
}

/**
 * Friendly email-body editor: a visual (Tiptap) editor where variables show
 * as labeled pills, with an "Edit HTML" fallback for templates whose markup
 * the visual editor can't fully model. The stored value is always the raw
 * `bodyHtml` string with bare `{{token}}`s — unchanged from before.
 */
export function EmailBodyField({ value, onChange, variables }: EmailBodyFieldProps) {
  const [htmlMode, setHtmlMode] = useState(false);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label>Email body</Label>
        <button
          type="button"
          onClick={() => setHtmlMode((m) => !m)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
        >
          {htmlMode ? <PenLine className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
          {htmlMode ? 'Visual editor' : 'Edit HTML'}
        </button>
      </div>

      {htmlMode ? (
        <RawBody value={value} onChange={onChange} variables={variables} />
      ) : (
        <WysiwygBody value={value} onChange={onChange} variables={variables} />
      )}
    </div>
  );
}

// ── Visual editor ────────────────────────────────────────────────────────────

function WysiwygBody({ value, onChange, variables }: EmailBodyFieldProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: 'Write the email…' }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      VariableToken.configure({ labels: VARIABLE_LABELS }),
      CtaButton,
    ],
    content: tokensToPillHtml(value),
    onUpdate: ({ editor: ed }) => {
      onChange(pillsToTokenHtml(ed.getHTML()));
    },
    editorProps: {
      attributes: { class: 'tiptap-surface focus:outline-none px-3 py-2 text-sm min-h-[220px]' },
    },
  });

  function insertVariable(name: string) {
    editor.chain().focus().insertContent({ type: 'variableToken', attrs: { name } }).run();
  }

  return (
    <div className="border-input bg-background overflow-hidden rounded-md border">
      <Toolbar editor={editor} />
      <VariableChips variables={variables} onInsert={insertVariable} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="border-input bg-muted/40 flex flex-wrap items-center gap-1 border-b px-2 py-1">
      <ToolbarButton
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
        icon={<Bold className="h-4 w-4" />}
      />
      <ToolbarButton
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
        icon={<Italic className="h-4 w-4" />}
      />
      <span className="bg-border mx-1 h-5 w-px" />
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
      <span className="bg-border mx-1 h-5 w-px" />
      <ToolbarButton
        active={editor.isActive('link')}
        onClick={() => insertOrEditLink(editor)}
        title="Add/edit link"
        icon={<LinkIcon className="h-4 w-4" />}
      />
      <ToolbarButton
        onClick={() => insertCtaButton(editor)}
        title="Insert button"
        icon={<MousePointerClick className="h-4 w-4" />}
      />
    </div>
  );
}

function insertCtaButton(editor: Editor) {
  const label = window.prompt('Button label', 'Sign in');
  if (label === null || label.trim() === '') return;
  const href = window.prompt('Button link (URL or {{variable}})', '{{signInLink}}');
  if (href === null || href.trim() === '') return;
  editor
    .chain()
    .focus()
    .insertContent({ type: 'ctaButton', attrs: { href: href.trim(), label: label.trim() } })
    .run();
}

function ToolbarButton({
  onClick,
  active,
  title,
  icon,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        'hover:bg-accent hover:text-accent-foreground inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {icon}
    </button>
  );
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

// ── Raw HTML fallback ─────────────────────────────────────────────────────────

function RawBody({ value, onChange, variables }: EmailBodyFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function insertVariable(name: string) {
    const el = ref.current;
    const token = `{{${name}}}`;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <>
      <VariableChips variables={variables} onInsert={insertVariable} bordered />
      <Textarea
        ref={ref}
        className="min-h-[220px] font-mono text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}

// ── Shared variable chips ─────────────────────────────────────────────────────

function VariableChips({
  variables,
  onInsert,
  bordered = false,
}: {
  variables: TemplateVariable[];
  onInsert: (name: string) => void;
  bordered?: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-background flex flex-wrap items-center gap-1.5 px-2 py-1.5',
        bordered ? 'border-input rounded-md border' : 'border-input border-b',
      )}
    >
      <span className="text-muted-foreground mr-1 text-xs">Insert:</span>
      {variables.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700 transition-colors hover:bg-blue-100"
          title={`Inserts {{${v}}}`}
        >
          {variableLabel(v)}
        </button>
      ))}
    </div>
  );
}
