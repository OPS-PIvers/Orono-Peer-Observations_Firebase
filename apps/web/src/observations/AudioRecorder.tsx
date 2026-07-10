import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  FileInput,
  Loader2,
  Mic,
  RefreshCw,
  Sparkles,
  Square,
  Upload,
} from 'lucide-react';
import { getIdToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import type { TranscriptionJob } from '@ops/shared';
import { auth, functions, functionsHttpUrl } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/AuthProvider';
import { useGeminiFeatures } from '@/hooks/useGeminiFeatures';
import { cn } from '@/lib/utils';
import { useTranscriptionJobs } from './useTranscriptionJobs';

interface RequestTranscriptionResponse {
  jobId?: string;
}

const requestTranscriptionFn = httpsCallable<
  { observationId: string; audioFileId: string },
  RequestTranscriptionResponse
>(functions, 'requestTranscription');

export interface AudioRecorderProps {
  observationId: string;
  audioFileIds: string[];
  transcripts: Record<string, string>;
  readOnly?: boolean;
  onUploaded?: (audioFileId: string) => void;
  /** Notifies the parent when recording phase changes — used by the
   *  toolbar to render a red-dot indicator while recording is in flight. */
  onPhaseChange?: (phase: Phase) => void;
  /** Appends the finished transcript for a recording into the observation's
   *  script doc. Omit to hide the "Insert into script" action. */
  onInsertTranscript?: ((audioFileId: string) => void) | undefined;
}

export type Phase = 'idle' | 'recording' | 'uploading' | 'error';

/**
 * In-browser audio recorder backed by MediaRecorder. Records as webm/opus
 * (Chrome/Firefox) or audio/mp4 (Safari/iPad) and uploads via the
 * `uploadAudio` Cloud Function on stop. The function writes the file to
 * the observation's Drive folder, owned by the service account.
 *
 * The list of recorded audio is rendered live from the observation doc
 * (whatever `audioFileIds` the parent passes in); playback streams through
 * the `getAudio` Cloud Function so the SA-owned files don't need direct
 * Drive sharing for the observer.
 */
export function AudioRecorder({
  observationId,
  audioFileIds,
  transcripts,
  readOnly = false,
  onUploaded,
  onPhaseChange,
  onInsertTranscript,
}: AudioRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** Request-time failures (e.g. the callable itself rejecting, before a
   *  job doc even exists) — separate from a job's own `status: 'Failed'`,
   *  which is surfaced from `jobsByAudioFileId` below. */
  const [requestError, setRequestError] = useState<Record<string, string>>({});
  /** fileIds whose transcript has been inserted into the script this
   *  session (local feedback only — inserting again is always allowed). */
  const [insertedIds, setInsertedIds] = useState<Set<string>>(new Set());
  const transcriptionEnabled = useGeminiFeatures().audioTranscription.enabled;
  const { user } = useAuth();
  // Job docs are the source of truth for in-flight/failed state so it
  // survives a page reload — no local "transcribing" flag to lose.
  const { jobsByAudioFileId } = useTranscriptionJobs(
    observationId,
    user?.email?.toLowerCase() ?? null,
  );
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestTranscription = useCallback(
    async (audioFileId: string) => {
      // A job for this file is already Pending/Running — the server is
      // idempotent about this too, but skip the round-trip client-side.
      const inflightStatus = jobsByAudioFileId[audioFileId]?.status;
      if (inflightStatus === 'Pending' || inflightStatus === 'Running') return;

      setRequestError((prev) => {
        const { [audioFileId]: _omit, ...rest } = prev;
        void _omit;
        return rest;
      });
      // A re-transcribe produces new text, so the "inserted" feedback for
      // this recording no longer reflects what's in the script.
      setInsertedIds((prev) => {
        if (!prev.has(audioFileId)) return prev;
        const next = new Set(prev);
        next.delete(audioFileId);
        return next;
      });
      try {
        await requestTranscriptionFn({ observationId, audioFileId });
      } catch (err) {
        setRequestError((prev) => ({
          ...prev,
          [audioFileId]: err instanceof Error ? err.message : 'Transcription request failed',
        }));
      }
    },
    [observationId, jobsByAudioFileId],
  );

  const handleInsertTranscript = useCallback(
    (audioFileId: string) => {
      if (!onInsertTranscript) return;
      onInsertTranscript(audioFileId);
      setInsertedIds((prev) => new Set(prev).add(audioFileId));
    },
    [onInsertTranscript],
  );

  useEffect(() => {
    return () => {
      stopTracks();
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  function stopTracks() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }

  async function startRecording() {
    setError(null);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // recorder.mimeType can be the empty string if the browser couldn't
        // honor our preferred type — fall through to picked or default.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        const finalMime = recorder.mimeType || mimeType || 'audio/webm';
        void uploadRecording(finalMime);
      };
      recorder.onerror = () => {
        setError('Recorder error. Try again or refresh the page.');
        setPhase('error');
        stopTracks();
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setPhase('recording');
      setElapsed(0);
      tickerRef.current = setInterval(() => {
        setElapsed((t) => t + 1);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not access microphone');
      setPhase('error');
    }
  }

  function stopRecording() {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      setPhase('uploading');
      recorderRef.current.stop();
    }
  }

  async function uploadRecording(mimeType: string) {
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      stopTracks();
      if (blob.size === 0) {
        setError('No audio captured.');
        setPhase('error');
        return;
      }
      const user = auth.currentUser;
      if (!user) {
        setError('Not signed in.');
        setPhase('error');
        return;
      }
      const idToken = await getIdToken(user);
      const response = await fetch(functionsHttpUrl('uploadAudio'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'X-Observation-Id': observationId,
          'X-Audio-Mime-Type': mimeType,
          'Content-Type': mimeType,
        },
        body: blob,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Upload failed (${String(response.status)}): ${text || response.statusText}`,
        );
      }
      const data = (await response.json()) as { audioFileId: string };
      setPhase('idle');
      onUploaded?.(data.audioFileId);
      // Auto-request transcription so the user doesn't have to click again
      // for the common path. Skipped when admins have disabled the feature.
      if (transcriptionEnabled) {
        void requestTranscription(data.audioFileId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPhase('error');
    }
  }

  return (
    <div className="border-border bg-background rounded-lg border p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold">Audio</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Record voice notes during the observation. After stopping, the recording uploads to this
            observation&apos;s Drive folder. When a transcript is ready, use{' '}
            <strong>Insert into script</strong> to add it to the observation script for tagging.
          </p>
        </div>
        <RecordButton
          phase={phase}
          disabled={readOnly}
          onStart={startRecording}
          onStop={stopRecording}
        />
      </header>

      <PhaseStatus phase={phase} elapsed={elapsed} error={error} />

      <RecordingsList
        observationId={observationId}
        audioFileIds={audioFileIds}
        transcripts={transcripts}
        jobsByAudioFileId={jobsByAudioFileId}
        requestError={requestError}
        onTranscribe={(id) => void requestTranscription(id)}
        transcriptionEnabled={transcriptionEnabled}
        readOnly={readOnly}
        onInsert={onInsertTranscript ? handleInsertTranscript : null}
        insertedIds={insertedIds}
      />
    </div>
  );
}

function RecordButton({
  phase,
  disabled,
  onStart,
  onStop,
}: {
  phase: Phase;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  if (phase === 'recording') {
    return (
      <Button variant="destructive" size="sm" onClick={onStop} disabled={disabled}>
        <Square className="h-4 w-4" />
        Stop
      </Button>
    );
  }
  if (phase === 'uploading') {
    return (
      <Button size="sm" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
        Uploading…
      </Button>
    );
  }
  return (
    <Button size="sm" onClick={onStart} disabled={disabled}>
      <Mic className="h-4 w-4" />
      Record
    </Button>
  );
}

function PhaseStatus({
  phase,
  elapsed,
  error,
}: {
  phase: Phase;
  elapsed: number;
  error: string | null;
}) {
  if (phase === 'recording') {
    return (
      <div className="text-ops-red mb-3 flex items-center gap-2 text-sm">
        <span className="bg-ops-red inline-block h-2 w-2 animate-pulse rounded-full" />
        <span>Recording… {formatDuration(elapsed)}</span>
      </div>
    );
  }
  if (phase === 'uploading') {
    return (
      <div className="text-muted-foreground mb-3 flex items-center gap-2 text-sm">
        <Upload className="h-4 w-4" />
        <span>Uploading to Drive…</span>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-3 flex items-start gap-2 rounded-md border-l-4 px-3 py-2 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  return null;
}

function RecordingsList({
  observationId,
  audioFileIds,
  transcripts,
  jobsByAudioFileId,
  requestError,
  onTranscribe,
  transcriptionEnabled,
  readOnly,
  onInsert,
  insertedIds,
}: {
  observationId: string;
  audioFileIds: string[];
  transcripts: Record<string, string>;
  jobsByAudioFileId: Record<string, TranscriptionJob>;
  requestError: Record<string, string>;
  onTranscribe: (audioFileId: string) => void;
  transcriptionEnabled: boolean;
  readOnly: boolean;
  onInsert: ((audioFileId: string) => void) | null;
  insertedIds: Set<string>;
}) {
  if (audioFileIds.length === 0) {
    return (
      <p className="text-muted-foreground py-2 text-xs">
        No recordings yet. Click <strong>Record</strong> to start.
      </p>
    );
  }
  return (
    <ul className="divide-border divide-y">
      {audioFileIds.map((fileId, i) => {
        const transcript = transcripts[fileId];
        const job = jobsByAudioFileId[fileId];
        const isTranscribing = job?.status === 'Pending' || job?.status === 'Running';
        const isFailed = job?.status === 'Failed';
        // A request-time failure (callable rejected outright) takes
        // priority since it means no job doc exists to explain itself.
        const errMsg =
          requestError[fileId] ?? (isFailed ? (job.error ?? 'Transcription failed') : undefined);
        const isInserted = insertedIds.has(fileId);
        return (
          <li key={fileId} className="py-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">
                Recording {String(i + 1)}
                {transcript
                  ? ' · transcript ready'
                  : isTranscribing
                    ? job.status === 'Running'
                      ? ' · transcribing…'
                      : ' · queued…'
                    : isFailed
                      ? ' · transcription failed'
                      : ' · no transcript yet'}
              </span>
              {!readOnly && transcriptionEnabled ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onTranscribe(fileId);
                  }}
                  disabled={isTranscribing}
                  className="h-7 text-xs"
                  title={
                    transcript ? 'Re-transcribe this recording' : 'Generate transcript with Gemini'
                  }
                >
                  {isTranscribing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : transcript ? (
                    <RefreshCw className="h-3 w-3" />
                  ) : isFailed ? (
                    <RefreshCw className="h-3 w-3" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {isTranscribing
                    ? job.status === 'Running'
                      ? 'Transcribing…'
                      : 'Queued…'
                    : transcript
                      ? 'Re-transcribe'
                      : isFailed
                        ? 'Retry'
                        : 'Transcribe'}
                </Button>
              ) : null}
            </div>
            <RecordingPlayer observationId={observationId} audioFileId={fileId} />
            {errMsg ? (
              <p className="text-destructive mt-1 flex items-start gap-1 text-xs">
                <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span>{errMsg}</span>
              </p>
            ) : null}
            {transcript ? (
              <details className="mt-2" open>
                <summary className="text-muted-foreground cursor-pointer text-xs">
                  Transcript
                </summary>
                <p className="text-foreground mt-1 text-sm whitespace-pre-line">{transcript}</p>
                {!readOnly && onInsert ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onInsert(fileId);
                      }}
                      className="h-7 text-xs"
                      title="Append this transcript to the observation script so it can be tagged as rubric evidence"
                    >
                      <FileInput className="h-3 w-3" />
                      {isInserted ? 'Insert into script again' : 'Insert into script'}
                    </Button>
                    {isInserted ? (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        <Check className="h-3 w-3" />
                        Added to script
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </details>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function RecordingPlayer({
  observationId,
  audioFileId,
}: {
  observationId: string;
  audioFileId: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAudio() {
    setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');
      const idToken = await getIdToken(user);
      const url = `${functionsHttpUrl('getAudio')}?observationId=${encodeURIComponent(observationId)}&audioFileId=${encodeURIComponent(audioFileId)}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
      if (!response.ok) throw new Error(`Fetch failed: ${String(response.status)}`);
      const blob = await response.blob();
      setSrc(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audio');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  if (src) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption -- voice recording, no captions available
      <audio controls src={src} className="w-full" />
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void loadAudio()}
        disabled={loading}
        className={cn('text-xs', loading && 'opacity-60')}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Load audio'}
      </Button>
      {error ? <span className="text-destructive text-xs">{error}</span> : null}
    </div>
  );
}

function pickSupportedMimeType(): string | null {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
