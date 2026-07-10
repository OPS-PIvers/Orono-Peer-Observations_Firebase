import { useEffect, useState } from 'react';
import { Loader2, WifiOff } from 'lucide-react';
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
  onRetry,
  isOnline = true,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
  onRetry?: () => void;
  // Browser-reported connectivity (see useOnlineStatus). Defaults to `true`
  // so callers that don't track it (none currently) keep the prior
  // behavior. When `false` and a save is in flight or failed, we know the
  // cause is the network drop rather than a real server/client error, so we
  // show a distinct "offline" message instead of a dead-end error string —
  // the caller auto-retries once the browser reports it's back online.
  isOnline?: boolean;
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

  if (!isOnline && (state === 'saving' || state === 'error')) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-amber-700">
        <WifiOff className="h-3 w-3" /> Offline — will retry when back online
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="text-destructive inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap">
        Save failed: {error}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-destructive font-semibold underline underline-offset-2 hover:no-underline"
          >
            Retry
          </button>
        ) : null}
      </span>
    );
  }
  if (state === 'saving' && showSavingLabel) {
    return (
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  // While 'saving' but pre-delay, keep showing the prior "Saved"
  // label so the indicator doesn't flicker. Don't claim "saved" before
  // the first successful write.
  if (state === 'saved' || (state === 'saving' && everSaved)) {
    return (
      <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap">
        Saved
      </span>
    );
  }
  return null;
}

export function StatusBadge({ status }: { status: Observation['status'] }) {
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
  return (
    <span className="bg-ops-blue-lighter text-ops-blue-dark border-ops-blue/30 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase">
      Finalized
    </span>
  );
}
