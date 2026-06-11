import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ClipboardCopy,
  Download,
  Loader2,
  Mic,
  PlusCircle,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { getIdToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions, functionsHttpUrl } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { useGeminiFeatures } from '@/hooks/useGeminiFeatures';
import { useTranscriptionJob } from '@/hooks/useTranscriptionJob';
import { cn } from '@/lib/utils';

interface RequestTranscriptionResponse {
  jobId?: string;
}

const requestTranscriptionFn = httpsCallable<
  { observationId: string; audioFileId: string },
  RequestTranscriptionResponse
>(functions, 'requestTranscription');

const deleteObservationFileFn = httpsCallable<
  { observationId: string; kind: 'audio'; driveFileId: string },
  { deleted: boolean }
>(functions, 'deleteObservationFile');

export interface AudioRecorderProps {
  observationId: string;
  audioFileIds: string[];
  transcripts: Record<string, string>;
  readOnly?: boolean;
  onUploaded?: (audioFileId: string) => void;
  /** Notifies the parent when recording phase changes — used by the
   *  toolbar to render a red-dot indicator while recording is in flight. */
  onPhaseChange?: (phase: Phase) => void;
  /** Called when the user clicks "Insert into script" on a transcript.
   *  The parent is responsible for appending the text to the Tiptap scriptDoc. */
  onInsertTranscript?: (text: string) => void;
}

export type Phase = 'idle' | 'recording' | 'uploading' | 'error';

/**
 * In-browser audio recorder backed by MediaRecorder. Records as webm/opus
 * (Chrome/Firefox) or audio/mp4 (Safari/iPad) and uploads via the
 * `uploadAudio` Cloud Function on stop. The function writes the file to
 * the observation's Drive folder, owned by the service account.
 *
 * If an upload fails, the recorded blob is retained so the observer can
 * retry the upload or download the recording locally rather than losing it.
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
  /** Retained recording after a failed upload so the user can retry/download. */
  const [failedUpload, setFailedUpload] = useState<{ blob: Blob; mimeType: string } | null>(null);
  /** Object URL for the failed-upload download link (revoked on cleanup). */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  /** fileIds with a transcription request in flight (local optimistic). */
  const [transcribing, setTranscribing] = useState<Set<string>>(new Set());
  const [transcribeError, setTranscribeError] = useState<Record<string, string>>({});
  /** Locally-tracked jobId per recording, returned by requestTranscription. */
  const [jobIds, setJobIds] = useState<Record<string, string>>({});
  const transcriptionEnabled = useGeminiFeatures().audioTranscription.enabled;
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
        const result = await requestTranscriptionFn({ observationId, audioFileId });
        const jobId = result.data.jobId;
        if (jobId) setJobIds((prev) => ({ ...prev, [audioFileId]: jobId }));
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

  // While recording, warn the user before they navigate away / close the tab
  // so an in-progress capture isn't silently lost.
  useEffect(() => {
    if (phase !== 'recording') return;
    const handler = (e: BeforeUnloadEvent) => {
      // Calling preventDefault is the modern way to trigger the browser's
      // "leave site?" confirmation; the deprecated returnValue is not needed.
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
    };
  }, [phase]);

  useEffect(() => {
    return () => {
      stopTracks();
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, []);

  // Revoke the failed-upload object URL when it changes or unmounts.
  useEffect(() => {
    return () => {
      if (failedUrl) URL.revokeObjectURL(failedUrl);
    };
  }, [failedUrl]);

  function stopTracks() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }

  /** Clear any retained failed-upload recovery state. */
  function clearFailedUpload() {
    setFailedUpload(null);
    setFailedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  async function startRecording() {
    setError(null);
    clearFailedUpload();
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

  /** POST a recorded blob to the uploadAudio function. On failure the blob is
   *  retained for retry/download via `failedUpload`. */
  async function uploadBlob(blob: Blob, mimeType: string) {
    setPhase('uploading');
    try {
      const user = auth.currentUser;
      if (!user) {
        setError('Not signed in.');
        setFailedUpload({ blob, mimeType });
        setFailedUrl(URL.createObjectURL(blob));
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
      clearFailedUpload();
      setError(null);
      setPhase('idle');
      onUploaded?.(data.audioFileId);
      // Auto-request transcription so the user doesn't have to click again
      // for the common path. Skipped when admins have disabled the feature.
      if (transcriptionEnabled) {
        void requestTranscription(data.audioFileId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setFailedUpload({ blob, mimeType });
      setFailedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setPhase('error');
    }
  }

  async function uploadRecording(mimeType: string) {
    const blob = new Blob(chunksRef.current, { type: mimeType });
    stopTracks();
    if (blob.size === 0) {
      setError('No audio captured.');
      setPhase('error');
      return;
    }
    await uploadBlob(blob, mimeType);
  }

  function retryUpload() {
    if (!failedUpload) return;
    void uploadBlob(failedUpload.blob, failedUpload.mimeType);
  }

  return (
    <div className="border-border bg-background rounded-lg border p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold">Audio</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Record voice notes during the observation. After stopping, the recording uploads to this
            observation&apos;s Drive folder. Once a transcript is ready, use{' '}
            <strong>Insert into script</strong> to append it to the scripting area.
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

      {failedUpload && failedUrl ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-3 flex flex-wrap items-center gap-2 rounded-md border-l-4 px-3 py-2 text-sm">
          <span className="mr-auto">Upload didn&apos;t go through. Retry, or save it locally.</span>
          <Button size="sm" variant="outline" onClick={retryUpload}>
            <RefreshCw className="h-3 w-3" />
            Retry upload
          </Button>
          <a
            href={failedUrl}
            download={`recording.${mimeExtension(failedUpload.mimeType)}`}
            className="border-input hover:bg-accent inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium"
          >
            <Download className="h-3 w-3" />
            Download recording
          </a>
        </div>
      ) : null}

      {/* Persistent polite live region so recording phase changes are
          announced to screen readers. The visible PhaseStatus carries the
          ticking timer (aria-hidden by omission here) so it isn't re-read
          every second. */}
      <span className="sr-only" role="status" aria-live="polite">
        {phase === 'recording'
          ? 'Recording in progress'
          : phase === 'uploading'
            ? 'Uploading audio to Drive'
            : phase === 'error'
              ? `Recording error${error ? `: ${error}` : ''}`
              : ''}
      </span>

      <RecordingsList
        observationId={observationId}
        audioFileIds={audioFileIds}
        transcripts={transcripts}
        transcribing={transcribing}
        transcribeError={transcribeError}
        jobIds={jobIds}
        onTranscribe={(id) => void requestTranscription(id)}
        transcriptionEnabled={transcriptionEnabled}
        readOnly={readOnly}
        {...(onInsertTranscript ? { onInsertTranscript } : {})}
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
  jobIds,
  onTranscribe,
  transcriptionEnabled,
  readOnly,
  onInsertTranscript,
}: {
  observationId: string;
  audioFileIds: string[];
  transcripts: Record<string, string>;
  transcribing: Set<string>;
  transcribeError: Record<string, string>;
  jobIds: Record<string, string>;
  onTranscribe: (audioFileId: string) => void;
  transcriptionEnabled: boolean;
  readOnly: boolean;
  onInsertTranscript?: (text: string) => void;
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
      {audioFileIds.map((fileId, i) => (
        <RecordingRow
          key={fileId}
          index={i}
          observationId={observationId}
          fileId={fileId}
          transcript={transcripts[fileId]}
          isTranscribing={transcribing.has(fileId)}
          errMsg={transcribeError[fileId]}
          jobId={jobIds[fileId] ?? null}
          onTranscribe={onTranscribe}
          transcriptionEnabled={transcriptionEnabled}
          readOnly={readOnly}
          {...(onInsertTranscript ? { onInsertTranscript } : {})}
        />
      ))}
    </ul>
  );
}

function RecordingRow({
  index,
  observationId,
  fileId,
  transcript,
  isTranscribing,
  errMsg,
  jobId,
  onTranscribe,
  transcriptionEnabled,
  readOnly,
  onInsertTranscript,
}: {
  index: number;
  observationId: string;
  fileId: string;
  transcript: string | undefined;
  isTranscribing: boolean;
  errMsg: string | undefined;
  jobId: string | null;
  onTranscribe: (audioFileId: string) => void;
  transcriptionEnabled: boolean;
  readOnly: boolean;
  onInsertTranscript?: (text: string) => void;
}) {
  const job = useTranscriptionJob(jobId);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A live job status takes precedence over the local optimistic flag.
  const jobInProgress = job.status === 'Pending' || job.status === 'Running';
  const jobFailed = job.status === 'Failed';
  const busy = isTranscribing || jobInProgress;

  async function remove() {
    if (!confirm('Delete this recording? This also removes its transcript and cannot be undone.')) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteObservationFileFn({ observationId, kind: 'audio', driveFileId: fileId });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  async function copyTranscript() {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard write failed — silently ignore; the user can select manually.
    }
  }

  return (
    <li className="py-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs" aria-live="polite">
          Recording {String(index + 1)}
          {transcript
            ? ' · transcript ready'
            : job.status === 'Pending'
              ? ' · pending...'
              : job.status === 'Running' || isTranscribing
                ? ' · transcribing...'
                : jobFailed
                  ? ' · failed'
                  : ' · no transcript yet'}
        </span>
        <div className="flex items-center gap-1">
          {!readOnly && transcriptionEnabled ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onTranscribe(fileId);
              }}
              disabled={busy}
              className="h-7 text-xs"
              title={
                transcript ? 'Re-transcribe this recording' : 'Generate transcript with Gemini'
              }
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : transcript || jobFailed ? (
                <RefreshCw className="h-3 w-3" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {busy
                ? 'Transcribing...'
                : jobFailed
                  ? 'Retry'
                  : transcript
                    ? 'Re-transcribe'
                    : 'Transcribe'}
            </Button>
          ) : null}
          {!readOnly ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void remove()}
              disabled={deleting}
              aria-label={`Remove recording ${String(index + 1)}`}
              className="h-7 w-7"
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
            </Button>
          ) : null}
        </div>
      </div>
      <RecordingPlayer observationId={observationId} audioFileId={fileId} />
      {jobFailed && job.error ? (
        <p className="text-destructive mt-1 text-xs">Transcription failed: {job.error}</p>
      ) : null}
      {errMsg ? <p className="text-destructive mt-1 text-xs">{errMsg}</p> : null}
      {deleteError ? <p className="text-destructive mt-1 text-xs">{deleteError}</p> : null}
      {transcript ? (
        <details className="mt-2" open>
          <summary className="text-muted-foreground cursor-pointer text-xs">Transcript</summary>
          <p className="text-foreground mt-1 text-sm whitespace-pre-line">{transcript}</p>
          {!readOnly ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => void copyTranscript()}
                aria-label={`Copy transcript for recording ${String(index + 1)}`}
              >
                {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
              {onInsertTranscript ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    onInsertTranscript(transcript);
                  }}
                  aria-label={`Insert transcript for recording ${String(index + 1)} into script`}
                >
                  <PlusCircle className="h-3 w-3" />
                  Insert into script
                </Button>
              ) : null}
            </div>
          ) : null}
        </details>
      ) : null}
    </li>
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

/** Best-effort file extension for a recorded MIME type, for the download link. */
function mimeExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
