import { useEffect, useState } from 'react';
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

  if (state === 'error') {
    return <span className="text-destructive text-xs">Save failed: {error}</span>;
  }
  if (state === 'saving' && showSavingLabel) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  // While 'saving' but pre-delay, keep showing the prior "All changes saved"
  // label so the indicator doesn't flicker. Don't claim "saved" before the
  // first successful write.
  if (state === 'saved' || (state === 'saving' && everSaved)) {
    return <span className="text-muted-foreground text-xs">All changes saved</span>;
  }
  return null;
}

export function StatusBadge({ status }: { status: Observation['status'] }) {
  if (status === OBSERVATION_STATUS.draft) {
    return (
      <span
        className={cn(
          'bg-muted text-muted-foreground inline-flex items-center rounded px-2 py-0.5 text-xs',
        )}
      >
        Draft
      </span>
    );
  }
  return (
    <span className="bg-accent text-accent-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
      Finalized
    </span>
  );
}
