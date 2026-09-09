import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Quote } from 'lucide-react';

interface FloatingSelection {
  text: string;
  top: number;
  left: number;
}

/**
 * Wraps a read-only answer so the evaluator can select a sentence inside it
 * and lift it into the script as evidence. A floating "Add to script"
 * button follows the selection; nothing renders when `onCapture` is absent
 * (the teacher's own view, or a finalized observation).
 *
 * Selection-based rather than whole-answer on purpose: the useful unit of
 * evidence is one sentence, not a three-paragraph reflection.
 */
export function SelectableAnswer({
  children,
  onCapture,
}: {
  children: ReactNode;
  onCapture?: ((text: string) => void) | undefined;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<FloatingSelection | null>(null);

  // Reads the live selection into state. Wired to `selectionchange` and,
  // belt-and-braces, to mouse/key release on the host — some embedded
  // browsers deliver the latter without the former.
  const update = useCallback(() => {
    const host = hostRef.current;
    const sel = window.getSelection();
    if (!host || !sel || sel.rangeCount === 0 || sel.isCollapsed) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    setSelection({
      text,
      top: rect.top - hostRect.top,
      left: Math.max(0, rect.left - hostRect.left + rect.width / 2),
    });
  }, []);

  useEffect(() => {
    if (!onCapture) return;
    const host = hostRef.current;
    document.addEventListener('selectionchange', update);
    host?.addEventListener('mouseup', update);
    host?.addEventListener('keyup', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      host?.removeEventListener('mouseup', update);
      host?.removeEventListener('keyup', update);
    };
  }, [onCapture, update]);

  return (
    <div ref={hostRef} className="relative">
      {children}
      {onCapture && selection ? (
        <button
          type="button"
          // Keep the selection alive through the click: a mousedown would
          // otherwise collapse it before onClick reads it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onCapture(selection.text);
            window.getSelection()?.removeAllRanges();
            setSelection(null);
          }}
          style={{ top: selection.top - 34, left: selection.left }}
          className="bg-ops-blue-dark hover:bg-ops-blue absolute z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white shadow-md"
        >
          <Quote className="h-3 w-3" aria-hidden="true" />
          Add to script
        </button>
      ) : null}
    </div>
  );
}
