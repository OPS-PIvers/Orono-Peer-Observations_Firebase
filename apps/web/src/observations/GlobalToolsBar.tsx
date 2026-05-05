import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mic } from 'lucide-react';
import { OBSERVATION_STATUS, type Observation, type Rubric } from '@ops/shared';
import { Button } from '@/components/ui/button';
import { DomainNav } from '@/components/rubric';
import { cn } from '@/lib/utils';
import { AudioRecorder, type Phase } from './AudioRecorder';

export interface GlobalToolsBarProps {
  observation: Observation & { id: string };
  canEdit: boolean;
  savingState: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  onFinalize: () => void;
  /** Rubric to render the domain jump nav for. Hidden if absent. */
  rubric: Rubric | null;
}

/**
 * Sticky top toolbar for the observation editor. Hosts:
 *   - <DomainNav> jump pills (when a rubric is loaded)
 *   - the audio recorder in a popover (always-mounted so closing the
 *     popover doesn't kill an in-flight `MediaRecorder`)
 *   - save status text
 *   - draft/finalized status badge
 *   - Finalize button (drafts only)
 */
export function GlobalToolsBar({
  observation,
  canEdit,
  savingState,
  saveError,
  onFinalize,
  rubric,
}: GlobalToolsBarProps) {
  const [audioPopoverOpen, setAudioPopoverOpen] = useState(false);
  const [recordingPhase, setRecordingPhase] = useState<Phase>('idle');
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Click-outside / Escape close. While recording, the popover stays open
  // so the user can hit Stop without re-opening it.
  useEffect(() => {
    if (!audioPopoverOpen) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (recordingPhase === 'recording' || recordingPhase === 'uploading') return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setAudioPopoverOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && recordingPhase !== 'recording' && recordingPhase !== 'uploading') {
        setAudioPopoverOpen(false);
      }
    }
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [audioPopoverOpen, recordingPhase]);

  const isDraft = observation.status === OBSERVATION_STATUS.draft;
  const showFinalize = canEdit && isDraft;

  return (
    <div
      className="border-ops-gray-lighter/70 bg-ops-gray-lightest/95 supports-[backdrop-filter]:bg-ops-gray-lightest/80 sticky top-0 z-20 -mx-4 border-y px-4 py-2 backdrop-blur md:-mx-6 md:px-6"
      data-testid="global-tools-bar"
    >
      <div className="flex flex-wrap items-center gap-3">
        {rubric ? <DomainNav rubric={rubric} /> : null}

        {/* Audio popover trigger + always-mounted recorder */}
        <div className="relative">
          <Button
            ref={triggerRef}
            type="button"
            variant={audioPopoverOpen ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAudioPopoverOpen((v) => !v)}
            aria-expanded={audioPopoverOpen}
            aria-controls="audio-popover"
            className="relative"
          >
            <Mic className="h-4 w-4" />
            Audio
            {observation.audioDriveFileIds.length > 0 ? (
              <span className="text-muted-foreground ml-1 text-xs">
                ({observation.audioDriveFileIds.length})
              </span>
            ) : null}
            {recordingPhase === 'recording' ? (
              <span
                aria-label="Recording in progress"
                className="bg-ops-red absolute -top-1 -right-1 inline-block h-2.5 w-2.5 animate-pulse rounded-full ring-2 ring-white"
              />
            ) : null}
          </Button>

          {/* Always-mounted; visibility toggled. Hiding via `hidden` keeps
              the MediaRecorder alive across open/close cycles. */}
          <div
            id="audio-popover"
            ref={popoverRef}
            hidden={!audioPopoverOpen}
            className="border-border bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-lg border p-3 shadow-lg"
          >
            <AudioRecorder
              observationId={observation.id}
              audioFileIds={observation.audioDriveFileIds}
              transcripts={observation.transcripts}
              readOnly={!canEdit}
              onPhaseChange={setRecordingPhase}
            />
          </div>
        </div>

        {/* Save status + status badge live to the right. */}
        <div className="ml-auto flex items-center gap-3">
          <SaveStatusIndicator state={savingState} error={saveError} />
          <StatusBadge status={observation.status} />
          {showFinalize ? (
            <Button onClick={onFinalize} size="sm">
              <CheckCircle2 className="h-4 w-4" />
              Finalize
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Wait this long before swapping the indicator to "Saving…". Fast writes
// (the common case on a healthy connection) finish well before this and
// never flash the spinner — the label stays on "All changes saved", which
// avoids the jittery saved/saving cycling that happens with per-keystroke
// autosave.
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
    if (state === 'saved') setEverSaved(true);
  }, [state]);

  useEffect(() => {
    if (state !== 'saving') {
      setShowSavingLabel(false);
      return;
    }
    const t = setTimeout(() => setShowSavingLabel(true), SAVING_LABEL_DELAY_MS);
    return () => clearTimeout(t);
  }, [state]);

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
  // While 'saving' but pre-delay, keep showing the prior "saved" label so
  // the indicator doesn't flicker between "Saved" and "Saving…" on every
  // keystroke. Don't claim "saved" before the first successful write.
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
