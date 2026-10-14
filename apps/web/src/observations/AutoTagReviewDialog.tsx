import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

/**
 * Where a suggestion stands after earlier reviews of the same run (see
 * `scriptTagRun.ts` in functions): `applied` is already in the script,
 * `stale` no longer matches it, `dismissed` was left out of an earlier Apply.
 */
export type AutoTagSuggestionStatus = 'pending' | 'applied' | 'dismissed' | 'stale';

/** A tag the AI proposed, as returned by the `suggestScriptTags` callable. */
export interface AutoTagSuggestion {
  paragraphIndex: number;
  text: string;
  componentId: string;
  componentTitle: string;
  /** The whole paragraph the span came from, shown as context. */
  paragraphText: string;
  status: AutoTagSuggestionStatus;
}

export interface AutoTagColor {
  bg: string;
  fg: string;
}

/** About the saved run being reviewed. */
export interface AutoTagRunInfo {
  /** True when this is an earlier run reopened, not a fresh AI call. */
  reused: boolean;
  createdAt: string | null;
  createdBy: string;
  runCount: number;
  reason: string | null;
}

/** Mirrors RERUN_REASON_MIN_LENGTH in functions/src/observations/scriptTagRun.ts. */
export const RERUN_REASON_MIN_LENGTH = 10;
const RERUN_REASON_MAX_LENGTH = 1000;

/** Only one review dialog is ever mounted, so static ids are collision-free. */
const ACCEPT_ALL_ID = 'autotag-accept-all';
const ROW_ID_PREFIX = 'autotag-suggestion-';
const RERUN_REASON_ID = 'autotag-rerun-reason';

const STATUS_LABEL: Partial<Record<AutoTagSuggestionStatus, string>> = {
  applied: 'Applied',
  dismissed: 'Left out last time',
  stale: 'Script changed',
};

function isSelectable(s: AutoTagSuggestion): boolean {
  return s.status === 'pending' || s.status === 'dismissed';
}

/** Pending suggestions start checked; anything already decided starts unchecked. */
function initialSelection(suggestions: readonly AutoTagSuggestion[]): Set<number> {
  const out = new Set<number>();
  suggestions.forEach((s, i) => {
    if (s.status === 'pending') out.add(i);
  });
  return out;
}

export interface AutoTagReviewDialogProps {
  open: boolean;
  suggestions: AutoTagSuggestion[];
  /** bg/fg per componentId, as the `componentTag` mark would render them. */
  colorById: Map<string, AutoTagColor>;
  /** Suggestions the AI returned that the server already discarded. */
  skippedCount: number;
  run: AutoTagRunInfo;
  applying: boolean;
  /** A re-run is in flight. */
  rerunning: boolean;
  error: string | null;
  onCancel: () => void;
  onApply: (kept: AutoTagSuggestion[]) => void;
  onRerun: (reason: string) => void;
}

/**
 * Checklist review of the AI's proposed component tags, shown *before*
 * anything is written to the observation script. The observer unchecks the
 * ones they disagree with and only the kept subset is sent to
 * `applyScriptTags`.
 *
 * The run is saved per observation, so clicking Auto-tag again reopens this
 * dialog on the same result, with earlier decisions shown, instead of
 * spending another AI call. Running it again is a deliberate step at the
 * bottom of the dialog and needs a short note on what changed, which is
 * passed to the model as extra context.
 *
 * Each row renders the source paragraph with the proposed span highlighted in
 * the component's own colors — the same `<mark>` + inline bg/fg convention the
 * `componentTag` mark and the mirrored script-notes view use — so the observer
 * previews exactly what the script will look like.
 */
export function AutoTagReviewDialog({
  open,
  suggestions,
  colorById,
  skippedCount,
  run,
  applying,
  rerunning,
  error,
  onCancel,
  onApply,
  onRerun,
}: AutoTagReviewDialogProps) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(() =>
    initialSelection(suggestions),
  );
  const [rerunOpen, setRerunOpen] = useState(false);
  const [reason, setReason] = useState('');

  // A fresh batch of suggestions starts from its own defaults.
  useEffect(() => {
    setSelected(initialSelection(suggestions));
    setRerunOpen(false);
    setReason('');
  }, [suggestions]);

  const selectableIndexes = useMemo(
    () => suggestions.flatMap((s, i) => (isSelectable(s) ? [i] : [])),
    [suggestions],
  );
  const keptCount = selected.size;
  const kept = useMemo(
    () => suggestions.filter((_, i) => selected.has(i)),
    [suggestions, selected],
  );
  const busy = applying || rerunning;
  const trimmedReason = reason.trim();
  const reasonReady = trimmedReason.length >= RERUN_REASON_MIN_LENGTH;
  const appliedCount = suggestions.filter((s) => s.status === 'applied').length;

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === selectableIndexes.length ? new Set<number>() : new Set(selectableIndexes),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-ops-blue h-4 w-4" />
            {run.reused ? 'Earlier auto-tag suggestions' : 'Review suggested tags'}
          </DialogTitle>
          <DialogDescription>
            {suggestions.length === 0
              ? 'The AI found no taggable evidence in this script.'
              : run.reused
                ? `Pick up where you left off. ${appliedCount > 0 ? `${String(appliedCount)} already applied. ` : ''}Check any you want to add, then apply.`
                : 'Nothing has been written to the script yet. Uncheck any suggestion you disagree with, then apply the rest.'}
            {skippedCount > 0
              ? ` ${String(skippedCount)} further suggestion${skippedCount === 1 ? ' was' : 's were'} discarded because the text couldn't be located verbatim.`
              : ''}
          </DialogDescription>
          <RunMeta run={run} />
        </DialogHeader>

        {suggestions.length > 0 ? (
          <>
            <div className="flex items-center justify-between border-b pb-2">
              <label
                htmlFor={ACCEPT_ALL_ID}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <Checkbox
                  id={ACCEPT_ALL_ID}
                  checked={keptCount === selectableIndexes.length && keptCount > 0}
                  indeterminate={keptCount > 0 && keptCount < selectableIndexes.length}
                  onChange={toggleAll}
                  disabled={busy || selectableIndexes.length === 0}
                />
                <span>Accept all</span>
              </label>
              <span className="text-muted-foreground text-xs">
                {String(keptCount)} of {String(selectableIndexes.length)} selected
              </span>
            </div>

            <ul className="-mx-1 max-h-[50vh] space-y-2 overflow-y-auto">
              {suggestions.map((suggestion, index) => {
                const color = colorById.get(suggestion.componentId);
                const selectable = isSelectable(suggestion);
                const accepted = selected.has(index) || suggestion.status === 'applied';
                const rowId = `${ROW_ID_PREFIX}${String(index)}`;
                const statusLabel = STATUS_LABEL[suggestion.status];
                return (
                  <li
                    key={`${String(suggestion.paragraphIndex)}-${suggestion.componentId}-${String(index)}`}
                    className="hover:bg-muted/40 rounded-md px-1 py-1.5"
                  >
                    <label
                      htmlFor={rowId}
                      className={
                        selectable
                          ? 'flex cursor-pointer items-start gap-2.5'
                          : 'flex items-start gap-2.5'
                      }
                    >
                      <Checkbox
                        id={rowId}
                        className="mt-0.5"
                        checked={accepted}
                        onChange={() => toggle(index)}
                        disabled={busy || !selectable}
                        aria-label={`Tag "${suggestion.text}" as ${suggestion.componentId}`}
                      />
                      <span className={accepted ? 'min-w-0 flex-1' : 'min-w-0 flex-1 opacity-50'}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium"
                            style={
                              color ? { backgroundColor: color.bg, color: color.fg } : undefined
                            }
                          >
                            {suggestion.componentId}
                          </span>
                          <span className="text-sm font-medium">{suggestion.componentTitle}</span>
                          {statusLabel ? (
                            <Badge tone={suggestion.status === 'applied' ? 'active' : 'neutral'}>
                              {statusLabel}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-xs leading-relaxed">
                          <HighlightedParagraph
                            paragraphText={suggestion.paragraphText}
                            match={suggestion.text}
                            color={color}
                          />
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        {rerunOpen ? (
          <div className="bg-muted/40 space-y-2 rounded-md border p-3">
            <label htmlFor={RERUN_REASON_ID} className="block text-sm font-medium">
              What should the AI know this time?
            </label>
            <p className="text-muted-foreground text-xs">
              Say what you added to the script or what the last run missed. This goes to the AI with
              the script, along with which suggestions you applied or left out.
            </p>
            <Textarea
              id={RERUN_REASON_ID}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={RERUN_REASON_MAX_LENGTH}
              disabled={rerunning}
              placeholder="e.g. I added notes from the second half of the lesson, and the last run missed the questioning in the exit discussion."
              className="min-h-16 text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">
                {reasonReady ? '' : `At least ${String(RERUN_REASON_MIN_LENGTH)} characters.`}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRerunOpen(false)}
                  disabled={rerunning}
                >
                  Never mind
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onRerun(trimmedReason)}
                  disabled={!reasonReady || busy}
                >
                  {rerunning ? 'Running…' : 'Run auto-tag again'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="bg-ops-red-lighter text-ops-red-dark rounded-md px-3 py-2 text-xs">
            {error}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          {!rerunOpen ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRerunOpen(true)}
              disabled={busy}
            >
              <RotateCcw className="h-4 w-4" />
              Run again…
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {suggestions.length === 0 ? 'Close' : 'Cancel'}
            </Button>
            {suggestions.length > 0 ? (
              <Button
                type="button"
                onClick={() => onApply(kept)}
                disabled={busy || keptCount === 0}
              >
                {applying
                  ? 'Applying…'
                  : `Apply ${String(keptCount)} tag${keptCount === 1 ? '' : 's'}`}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Run 2 · Oct 14, 2:05 PM · paul.ivers" plus the reason, when there was one. */
function RunMeta({ run }: { run: AutoTagRunInfo }) {
  const when = run.createdAt
    ? new Date(run.createdAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
  const who = run.createdBy.split('@')[0];
  const parts = [`Run ${String(run.runCount)}`, when, who].filter(Boolean);
  return (
    <div className="text-muted-foreground space-y-0.5 text-xs">
      <p>{parts.join(' · ')}</p>
      {run.reason ? <p className="italic">“{run.reason}”</p> : null}
    </div>
  );
}

/**
 * Render the source paragraph with the proposed span wrapped in a `<mark>`
 * carrying the component's inline bg/fg — mirroring how `ComponentTagMark`
 * renders once the tag is actually applied.
 */
function HighlightedParagraph({
  paragraphText,
  match,
  color,
}: {
  paragraphText: string;
  match: string;
  color: AutoTagColor | undefined;
}) {
  const start = paragraphText.indexOf(match);
  const style = color ? { backgroundColor: color.bg, color: color.fg } : undefined;
  if (start < 0) {
    // Defensive: the server only returns verbatim matches, so this is a
    // paragraph we couldn't line up. Show the span on its own rather than
    // dropping the observer's only view of what would be tagged.
    return (
      <mark data-component-tag="" className="rounded px-0.5" style={style}>
        {match}
      </mark>
    );
  }
  return (
    <>
      {paragraphText.slice(0, start)}
      <mark data-component-tag="" className="rounded px-0.5" style={style}>
        {match}
      </mark>
      {paragraphText.slice(start + match.length)}
    </>
  );
}
