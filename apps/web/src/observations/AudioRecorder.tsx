import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Mic, RefreshCw, Sparkles, Square, Upload } from 'lucide-react';
import { getIdToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions, functionsHttpUrl } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
}

type Phase = 'idle' | 'recording' | 'uploading' | 'error';

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
}: AudioRecorderProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** fileIds with a transcription request in flight (local optimistic). */
  const [transcribing, setTranscribing] = useState<Set<string>>(new Set());
  const [transcribeError, setTranscribeError] = useState<Record<string, string>>({});
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestTranscription = useCallback(
    async (audioFileId: string) => {
      setTranscribeError((prev) => {
        const { [audioFileId]: _omit, ...rest } = prev;
        void _omit;
        return rest;
      });
      setTranscribing((prev) => new Set(prev).add(audioFileId));
      try {
        await requestTranscriptionFn({ observationId, audioFileId });
      } catch (err) {
        setTranscribeError((prev) => ({
          ...prev,
          [audioFileId]: err instanceof Error ? err.message : 'Transcription request failed',
        }));
      }
    },
    [observationId],
  );

  // Once the observation doc updates with a transcript for a file we
  // optimistically marked "transcribing", clear the in-flight flag.
  useEffect(() => {
    if (transcribing.size === 0) return;
    let changed = false;
    const next = new Set(transcribing);
    for (const id of transcribing) {
      if (transcripts[id]) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) setTranscribing(next);
  }, [transcripts, transcribing]);

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
      // for the common path.
      void requestTranscription(data.audioFileId);
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
            observation&apos;s Drive folder. Transcription is requested separately and lands in the
            script when ready.
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
        transcribing={transcribing}
        transcribeError={transcribeError}
        onTranscribe={(id) => void requestTranscription(id)}
        readOnly={readOnly}
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
  transcribing,
  transcribeError,
  onTranscribe,
  readOnly,
}: {
  observationId: string;
  audioFileIds: string[];
  transcripts: Record<string, string>;
  transcribing: Set<string>;
  transcribeError: Record<string, string>;
  onTranscribe: (audioFileId: string) => void;
  readOnly: boolean;
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
        const isTranscribing = transcribing.has(fileId);
        const errMsg = transcribeError[fileId];
        return (
          <li key={fileId} className="py-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">
                Recording {String(i + 1)}
                {transcript
                  ? ' · transcript ready'
                  : isTranscribing
                    ? ' · transcribing…'
                    : ' · no transcript yet'}
              </span>
              {!readOnly ? (
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
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {isTranscribing ? 'Transcribing…' : transcript ? 'Re-transcribe' : 'Transcribe'}
                </Button>
              ) : null}
            </div>
            <RecordingPlayer observationId={observationId} audioFileId={fileId} />
            {errMsg ? <p className="text-destructive mt-1 text-xs">{errMsg}</p> : null}
            {transcript ? (
              <details className="mt-2" open>
                <summary className="text-muted-foreground cursor-pointer text-xs">
                  Transcript
                </summary>
                <p className="text-foreground mt-1 text-sm whitespace-pre-line">{transcript}</p>
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
