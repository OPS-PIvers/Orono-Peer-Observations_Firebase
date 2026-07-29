import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
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

/** A tag Gemini proposed, as returned by the `suggestScriptTags` callable. */
export interface AutoTagSuggestion {
  paragraphIndex: number;
  text: string;
  componentId: string;
  componentTitle: string;
  /** The whole paragraph the span came from, shown as context. */
  paragraphText: string;
}

export interface AutoTagColor {
  bg: string;
  fg: string;
}

/** Only one review dialog is ever mounted, so static ids are collision-free. */
const ACCEPT_ALL_ID = 'autotag-accept-all';
const ROW_ID_PREFIX = 'autotag-suggestion-';

export interface AutoTagReviewDialogProps {
  open: boolean;
  suggestions: AutoTagSuggestion[];
  /** bg/fg per componentId, as the `componentTag` mark would render them. */
  colorById: Map<string, AutoTagColor>;
  /** Suggestions Gemini returned that the server already discarded. */
  skippedCount: number;
  applying: boolean;
  error: string | null;
  onCancel: () => void;
  onApply: (kept: AutoTagSuggestion[]) => void;
}

/**
 * Checklist review of Gemini's proposed component tags, shown *before*
 * anything is written to the observation script. Every suggestion starts
 * accepted; the observer unchecks the ones they disagree with (or clears them
 * all) and only the kept subset is sent to `applyScriptTags`.
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
  applying,
  error,
  onCancel,
  onApply,
}: AutoTagReviewDialogProps) {
  const [rejected, setRejected] = useState<ReadonlySet<number>>(() => new Set<number>());

  // A fresh batch of suggestions starts fully accepted.
  useEffect(() => {
    setRejected(new Set<number>());
  }, [suggestions]);

  const keptCount = suggestions.length - rejected.size;
  const kept = useMemo(
    () => suggestions.filter((_, i) => !rejected.has(i)),
    [suggestions, rejected],
  );

  function toggle(index: number) {
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAll() {
    setRejected((prev) =>
      prev.size === 0 ? new Set(suggestions.map((_, i) => i)) : new Set<number>(),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !applying) onCancel();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-ops-blue h-4 w-4" />
            Review suggested tags
          </DialogTitle>
          <DialogDescription>
            Nothing has been written to the script yet. Uncheck any suggestion you disagree with,
            then apply the rest.
            {skippedCount > 0
              ? ` ${String(skippedCount)} further suggestion${skippedCount === 1 ? ' was' : 's were'} discarded because the text couldn't be located verbatim.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-b pb-2">
          <label htmlFor={ACCEPT_ALL_ID} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              id={ACCEPT_ALL_ID}
              checked={rejected.size === 0 && suggestions.length > 0}
              indeterminate={rejected.size > 0 && rejected.size < suggestions.length}
              onChange={toggleAll}
              disabled={applying}
            />
            <span>Accept all</span>
          </label>
          <span className="text-muted-foreground text-xs">
            {String(keptCount)} of {String(suggestions.length)} selected
          </span>
        </div>

        <ul className="-mx-1 space-y-2">
          {suggestions.map((suggestion, index) => {
            const color = colorById.get(suggestion.componentId);
            const accepted = !rejected.has(index);
            const rowId = `${ROW_ID_PREFIX}${String(index)}`;
            return (
              <li
                key={`${String(suggestion.paragraphIndex)}-${suggestion.componentId}-${String(index)}`}
                className="hover:bg-muted/40 rounded-md px-1 py-1.5"
              >
                <label htmlFor={rowId} className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    id={rowId}
                    className="mt-0.5"
                    checked={accepted}
                    onChange={() => toggle(index)}
                    disabled={applying}
                    aria-label={`Tag "${suggestion.text}" as ${suggestion.componentId}`}
                  />
                  <span className={accepted ? 'min-w-0 flex-1' : 'min-w-0 flex-1 opacity-50'}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium"
                        style={color ? { backgroundColor: color.bg, color: color.fg } : undefined}
                      >
                        {suggestion.componentId}
                      </span>
                      <span className="text-sm font-medium">{suggestion.componentTitle}</span>
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

        {error ? (
          <p className="bg-ops-red-lighter text-ops-red-dark rounded-md px-3 py-2 text-xs">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={applying}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onApply(kept)}
            disabled={applying || keptCount === 0}
          >
            {applying ? 'Applying…' : `Apply ${String(keptCount)} tag${keptCount === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
