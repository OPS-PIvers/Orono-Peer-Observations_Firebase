import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { OBSERVATION_STATUS, type Observation } from '@ops/shared';
import { cn } from '@/lib/utils';

// Defer rendering "Saving…" by this long. Fast writes (the common case on a
// healthy connection) finish well before this and never flash the spinner —
// the label stays on "All changes saved", avoiding the saved/saving jitter on
// per-keystroke autosave. On slow networks the spinner still appears.
const SAVING_LABEL_DELAY_MS = 600;

export function SaveStatusIndicator({
  state,
  error,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
}) {
  const [showSavingLabel, setShowSavingLabel] = useState(false);
  const [everSaved, setEverSaved] = useState(false);

  useEffect(() => {
    if (state !== 'saving') {
      setShowSavingLabel(false);
      if (state === 'saved' && !everSaved) setEverSaved(true);
      return;
    }
    const t = setTimeout(() => setShowSavingLabel(true), SAVING_LABEL_DELAY_MS);
    return () => clearTimeout(t);
  }, [state, everSaved]);

  let visual: ReactNode = null;
  // Plain-text mirror of the status for the live region — screen readers
  // announce changes to this without us touching the visual layout.
  let announcement = '';

  if (state === 'error') {
    visual = <span className="text-destructive text-xs">Save failed: {error}</span>;
    announcement = `Save failed${error ? `: ${error}` : ''}`;
  } else if (state === 'saving' && showSavingLabel) {
    visual = (
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
    announcement = 'Saving…';
  } else if (state === 'saved' || (state === 'saving' && everSaved)) {
    // While 'saving' but pre-delay, keep showing the prior "Saved" label so
    // the indicator doesn't flicker. Don't claim "saved" before the first
    // successful write.
    visual = (
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap">
        Saved
      </span>
    );
    announcement = 'All changes saved';
  }

  // The visual branch is unchanged (still renders nothing when idle); the
  // persistent, visually-hidden polite live region is what gets announced.
  return (
    <>
      {visual}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

export function StatusBadge({
  status,
  acknowledgedAt,
}: {
  status: Observation['status'];
  acknowledgedAt?: Observation['acknowledgedAt'];
}) {
  if (status === OBSERVATION_STATUS.draft) {
    return (
      <span
        className={cn(
          'bg-ops-gray-lighter text-ops-gray-dark inline-flex shrink-0 items-center rounded-full border border-gray-300 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
        )}
      >
        Draft
      </span>
    );
  }

  // For finalized observations also render the acknowledgement state.
  const ackDate = formatAckDate(acknowledgedAt);

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="bg-ops-blue-lighter text-ops-blue-dark border-ops-blue/30 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase">
        Finalized
      </span>
      {ackDate !== null ? (
        <span className="inline-flex shrink-0 items-center rounded-full border border-green-200 bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">
          Acknowledged {ackDate}
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          Awaiting acknowledgement
        </span>
      )}
    </span>
  );
}

/**
 * Format the acknowledgedAt timestamp for display. Accepts a JS Date, a
 * Firestore Timestamp-like (with toDate()), or an ISO string. Returns a short
 * locale date string, or null when the value cannot be parsed.
 */
export function formatAckDate(value: Observation['acknowledgedAt'] | undefined): string | null {
  if (!value) return null;
  const raw = value as unknown;
  let date: Date | null = null;
  if (raw instanceof Date) {
    date = raw;
  } else if (typeof raw === 'object' && raw !== null && 'toDate' in raw) {
    date = (raw as { toDate: () => Date }).toDate();
  } else if (typeof raw === 'string') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date) return null;
  return date.toLocaleDateString();
}
