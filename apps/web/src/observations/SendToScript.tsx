import { useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileInput,
  FileText,
  Loader2,
  PenLine,
  Sparkles,
  Target,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import {
  TRANSCRIPT_FOCUS_MAX,
  normalizeTranscriptFocus,
  type SummarizeTranscriptRequest,
  type TranscriptSummary,
  type TranscriptSummaryMode,
} from '@ops/shared';
import { functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { assertWritable } from '@/dev/viewAsGuard';
import { cn } from '@/lib/utils';

// The SDK gives up after 70s by default; summarizeTranscript may run for
// 300s on a full class period. Server timeout plus a margin, so the client
// never shows "failed" while the server finishes (and spends the quota).
const summarizeTranscriptFn = httpsCallable<SummarizeTranscriptRequest, TranscriptSummary>(
  functions,
  'summarizeTranscript',
  { timeout: 310_000 },
);

/** An assigned component, for the chips on the evidence option. */
export interface SendToScriptComponent {
  id: string;
  title: string;
  bg: string;
  fg: string;
}

type Choice = 'full' | TranscriptSummaryMode;

export interface SendToScriptProps {
  observationId: string;
  audioFileId: string;
  /** Appends the full transcript. */
  onInsertFull: () => void;
  /** Appends a condensed version. Null hides the options and leaves the
   *  plain "Insert into script" button (summaries off for this user). */
  onInsertSummary: ((summary: TranscriptSummary) => void) | null;
  /** The observation's assigned components, shown on the evidence option. */
  assignedComponents: SendToScriptComponent[];
  /** What was added to the script from this recording this session. */
  added: string[];
  /** True while a summary is being written, false when it settles. */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

/**
 * "Send to script" for one transcribed recording. Offers the full transcript,
 * evidence for the assigned components, or a summary around the observer's
 * own focus. The last two are generated from the full transcript on the
 * server (summarizeTranscript) and appended by the editor.
 */
export function SendToScript({
  observationId,
  audioFileId,
  onInsertFull,
  onInsertSummary,
  assignedComponents,
  added,
  onBusyChange,
}: SendToScriptProps) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>('domains');
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState<TranscriptSummaryMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addedList =
    added.length > 0 ? (
      <ul className="text-muted-foreground space-y-0.5 text-xs">
        {added.map((label, i) => (
          <li key={`${label}-${String(i)}`} className="flex items-center gap-1">
            <Check className="h-3 w-3 shrink-0" />
            Added to script: {label}
          </li>
        ))}
      </ul>
    ) : null;

  if (!onInsertSummary) {
    return (
      <div className="mt-2 space-y-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={onInsertFull}
          className="h-7 text-xs"
          title="Append this transcript to the observation script so it can be tagged as rubric evidence"
        >
          <FileInput className="h-3 w-3" />
          {added.length > 0 ? 'Insert into script again' : 'Insert into script'}
        </Button>
        {addedList}
      </div>
    );
  }

  async function send() {
    setError(null);
    if (choice === 'full') {
      onInsertFull();
      setOpen(false);
      return;
    }
    const typed = normalizeTranscriptFocus(focus);
    if (choice === 'custom' && !typed) return;
    setBusy(choice);
    onBusyChange?.(true);
    try {
      assertWritable();
      const { data } = await summarizeTranscriptFn({
        observationId,
        audioFileId,
        mode: choice,
        ...(choice === 'custom' && typed ? { focus: typed } : {}),
      });
      onInsertSummary?.(data);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate this. Try again.');
    } finally {
      setBusy(null);
      onBusyChange?.(false);
    }
  }

  if (busy) {
    return (
      <div
        role="status"
        className="border-ops-blue-lighter bg-ops-blue-lighter/40 mt-2 flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
      >
        <Loader2 className="text-ops-blue h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="text-ops-blue-dark">
          {busy === 'domains'
            ? 'Pulling evidence for the assigned components from the transcript…'
            : 'Writing a summary for your focus…'}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
        aria-expanded={open}
        className="h-7 text-xs"
      >
        <FileInput className="h-3 w-3" />
        Send to script
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </Button>

      {open ? (
        <div className="border-border rounded-md border bg-white p-3 shadow-[var(--shadow-popover)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-heading text-ops-blue-dark text-sm font-semibold">Send to script</p>
            <span className="text-muted-foreground text-[11px]">
              Built from the full transcript
            </span>
          </div>
          <div role="radiogroup" aria-label="What to send" className="space-y-1.5">
            <OptionCard
              selected={choice === 'full'}
              onSelect={() => setChoice('full')}
              icon={<FileText className="h-4 w-4" />}
              title="Full transcript"
              desc="Every word with timestamps, as it came back."
            />
            <OptionCard
              selected={choice === 'domains'}
              onSelect={() => setChoice('domains')}
              icon={<Target className="h-4 w-4" />}
              title="Assigned-domain evidence"
              desc="A short summary, then timestamped evidence for each assigned component, tagged so it lands on the rubric."
            >
              {assignedComponents.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {assignedComponents.map((c) => (
                    <span
                      key={c.id}
                      title={c.title}
                      className="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: c.bg, color: c.fg }}
                    >
                      <span className="font-mono font-semibold">{c.id}</span>
                      {choice === 'domains' ? <span className="truncate">{c.title}</span> : null}
                    </span>
                  ))}
                </div>
              ) : null}
            </OptionCard>
            <OptionCard
              selected={choice === 'custom'}
              onSelect={() => setChoice('custom')}
              icon={<PenLine className="h-4 w-4" />}
              title="Custom"
              desc="Tell it what to look for."
            >
              {choice === 'custom' ? (
                <>
                  <Textarea
                    rows={3}
                    value={focus}
                    maxLength={TRANSCRIPT_FOCUS_MAX}
                    onChange={(e) => setFocus(e.target.value)}
                    placeholder="e.g. How does the teacher respond to student answers?"
                    aria-label="What to look for"
                    className="mt-2 bg-white text-sm"
                  />
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    The assigned components and rubric language are included automatically.
                  </p>
                </>
              ) : null}
            </OptionCard>
          </div>
          {error ? (
            <p role="alert" className="text-destructive mt-2 flex items-start gap-1 text-xs">
              <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              onClick={() => void send()}
              disabled={choice === 'custom' && !normalizeTranscriptFocus(focus)}
            >
              {choice === 'full' ? (
                <FileInput className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {choice === 'full'
                ? 'Send full transcript'
                : choice === 'domains'
                  ? 'Send evidence to script'
                  : 'Generate and send'}
            </Button>
          </div>
        </div>
      ) : null}
      {addedList}
    </div>
  );
}

function OptionCard({
  selected,
  onSelect,
  icon,
  title,
  desc,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  desc: string;
  children?: ReactNode;
}) {
  // The radio is the card's top row; extra content (chips, the focus box)
  // sits below it, outside the button, so the textarea isn't nested in it.
  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-2 transition-colors',
        selected
          ? 'border-ops-blue bg-ops-blue-lighter/50'
          : 'border-border hover:bg-ops-gray-lightest',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="flex w-full gap-2.5 text-left"
      >
        <span
          className={cn(
            'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-ops-blue' : 'border-ops-gray-light',
          )}
        >
          {selected ? <span className="bg-ops-blue h-2 w-2 rounded-full" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'flex items-center gap-1.5 text-sm font-medium',
              selected ? 'text-ops-blue-dark' : 'text-foreground',
            )}
          >
            <span className={selected ? 'text-ops-blue' : 'text-ops-gray'}>{icon}</span>
            {title}
          </span>
          <span className="text-muted-foreground mt-0.5 block text-xs">{desc}</span>
        </span>
      </button>
      {children ? <div className="pl-[1.625rem]">{children}</div> : null}
    </div>
  );
}
