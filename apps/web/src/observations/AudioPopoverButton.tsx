import { useEffect, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import type { Observation } from '@ops/shared';
import { Button } from '@/components/ui/button';
import { AudioRecorder, type Phase } from './AudioRecorder';

export interface AudioPopoverButtonProps {
  observationId: string;
  audioFileIds: Observation['audioDriveFileIds'];
  transcripts: Observation['transcripts'];
  readOnly: boolean;
}

/**
 * Mic button + always-mounted AudioRecorder popover. Extracted from
 * `GlobalToolsBar` so it can live anywhere in the editor chrome without
 * inheriting the toolbar's stacking context. The popover is positioned
 * absolutely below the trigger button and uses a high z-index so it
 * stacks above sibling sticky chrome.
 *
 * The recorder is always mounted (visibility toggled via `hidden`) — that
 * keeps an in-flight `MediaRecorder` alive across open/close cycles, so
 * closing the popover mid-record doesn't drop the audio.
 */
export function AudioPopoverButton({
  observationId,
  audioFileIds,
  transcripts,
  readOnly,
}: AudioPopoverButtonProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Click-outside / Escape close. While recording or uploading, the
  // popover stays open so the user can hit Stop without re-opening it.
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (phase === 'recording' || phase === 'uploading') return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'recording' && phase !== 'uploading') {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open, phase]);

  // Keyboard focus management: move focus into the popover when it opens so
  // keyboard users land on the recorder, and restore focus to the trigger
  // when it closes (Escape / click-outside) so they aren't stranded.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const first = popoverRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (first ?? popoverRef.current)?.focus();
    } else if (!open && wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant={open ? 'default' : 'outline'}
        size="icon"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="audio-popover"
        aria-label={`Record audio${audioFileIds.length > 0 ? ` (${String(audioFileIds.length)} clip${audioFileIds.length === 1 ? '' : 's'})` : ''}`}
        className="relative h-9 w-9 shrink-0"
      >
        <Mic className="h-4 w-4" />
        {audioFileIds.length > 0 ? (
          <span className="bg-ops-blue absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
            {audioFileIds.length}
          </span>
        ) : null}
        {phase === 'recording' ? (
          <span
            aria-label="Recording in progress"
            className="bg-ops-red absolute -top-1 -right-1 inline-block h-2.5 w-2.5 animate-pulse rounded-full ring-2 ring-white"
          />
        ) : null}
      </Button>

      <div
        id="audio-popover"
        ref={popoverRef}
        hidden={!open}
        tabIndex={-1}
        role="dialog"
        aria-label="Audio recorder"
        className="border-border bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-lg border p-3 shadow-lg focus:outline-none"
      >
        <AudioRecorder
          observationId={observationId}
          audioFileIds={audioFileIds}
          transcripts={transcripts}
          readOnly={readOnly}
          onPhaseChange={setPhase}
        />
      </div>
    </div>
  );
}
