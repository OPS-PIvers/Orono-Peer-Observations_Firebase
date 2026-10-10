import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  FileInput,
  Loader2,
  Mic,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { getIdToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { RECORDING_LABEL_MAX, type AudioRecordingMeta, type TranscriptionJob } from '@ops/shared';
import { auth, functions, functionsHttpUrl } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/auth/AuthProvider';
import { useGeminiAccess } from '@/hooks/useGeminiAccess';
import { cn } from '@/lib/utils';
import { useTranscriptionJobs } from './useTranscriptionJobs';
import {
  fetchRecordingBlob,
  formatRecordedAt,
  formatRecordingDuration,
  recordingDownloadName,
  recordingTitle,
  saveBlob,
} from './recordings';
import { assertWritable, isViewAsActive } from '@/dev/viewAsGuard';

interface RequestTranscriptionResponse {
  jobId?: string;
}

const requestTranscriptionFn = httpsCallable<
  { observationId: string; audioFileId: string },
  RequestTranscriptionResponse
>(functions, 'requestTranscription');

interface RecordingRef {
  observationId: string;
  audioFileId: string;
}
const removeRecordingFn = httpsCallable<RecordingRef, { ok: true }>(functions, 'removeRecording');
const renameRecordingFn = httpsCallable<RecordingRef & { label: string }, { ok: true }>(
  functions,
  'renameRecording',
);
const getRecordingDriveLinkFn = httpsCallable<RecordingRef, { webViewLink: string }>(
  functions,
  'getRecordingDriveLink',
);
const backfillRecordingMetadataFn = httpsCallable<{ observationId: string }, { filled: number }>(
  functions,
  'backfillRecordingMetadata',
);

export interface AudioRecorderProps {
  observationId: string;
  audioFileIds: string[];
  transcripts: Record<string, string>;
  /** Per-recording date/duration/label, keyed by Drive file id. Missing on
   *  legacy docs and for recordings made before the map existed. */
  recordings?: Record<string, AudioRecordingMeta> | undefined;
  /** Observed staff member's name, used to name downloaded files. */
  observedName: string;
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
  recordings,
  observedName,
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
  const transcriptionEnabled = useGeminiAccess().audioTranscription;
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
  /** Wall-clock start of the current recording, sent with the upload so the
   *  list shows when it was recorded and how long it runs. */
  const startedAtRef = useRef<Date | null>(null);

  // Recordings made before per-recording metadata existed have no entry;
  // ask the server once per mount to fill them from Drive. Best-effort —
  // the list still renders (without date/duration) if this fails.
  const backfillRequestedRef = useRef(false);
  const needsBackfill = audioFileIds.some((id) => !recordings?.[id]);
  useEffect(() => {
    if (!needsBackfill || backfillRequestedRef.current || isViewAsActive()) return;
    backfillRequestedRef.current = true;
    backfillRecordingMetadataFn({ observationId }).catch(() => undefined);
  }, [needsBackfill, observationId]);

  const requestTranscription = useCallback(
    async (audioFileId: string) => {
      // A job for this file is already Pending/Running — the server is
      // idempotent about this too, but skip the round-trip client-side.
      const inflightStatus = jobsByAudioFileId[audioFileId]?.status;
      if (inflightStatus === 'Pending' || inflightStatus === 'Running') return;

      setRequestError((prev) => {
        const { [audioFileId]: _omit, ...rest } = prev;
        // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator
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
        assertWritable();
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
      startedAtRef.current = new Date();
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
      const startedAt = startedAtRef.current;
      const timing: Record<string, string> = startedAt
        ? {
            'X-Audio-Recorded-At': startedAt.toISOString(),
            'X-Audio-Duration-Sec': String(Math.round((Date.now() - startedAt.getTime()) / 1000)),
          }
        : {};
      const response = await fetch(functionsHttpUrl('uploadAudio'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'X-Observation-Id': observationId,
          'X-Audio-Mime-Type': mimeType,
          'Content-Type': mimeType,
          ...timing,
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
      // for the common path. Skipped when transcription isn't available to
      // this user (off, or beta without them on the list).
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
            observation&apos;s Drive folder.
            {transcriptionEnabled ? (
              <>
                {' '}
                When a transcript is ready, use <strong>Insert into script</strong> to add it to the
                observation script for tagging.
              </>
            ) : null}
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
        recordings={recordings ?? {}}
        observedName={observedName}
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
  recordings,
  observedName,
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
  recordings: Record<string, AudioRecordingMeta>;
  observedName: string;
  jobsByAudioFileId: Record<string, TranscriptionJob>;
  requestError: Record<string, string>;
  onTranscribe: (audioFileId: string) => void;
  transcriptionEnabled: boolean;
  readOnly: boolean;
  onInsert: ((audioFileId: string) => void) | null;
  insertedIds: Set<string>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Confirmed via the shared Dialog (not window.confirm), like evidence removal.
  async function handleDelete(audioFileId: string) {
    setConfirmingDelete(null);
    setDeletingId(audioFileId);
    setDeleteError(null);
    try {
      assertWritable();
      await removeRecordingFn({ observationId, audioFileId });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the recording');
    } finally {
      setDeletingId(null);
    }
  }

  if (audioFileIds.length === 0) {
    return (
      <p className="text-muted-foreground py-2 text-xs">
        No recordings yet. Click <strong>Record</strong> to start.
      </p>
    );
  }
  return (
    <>
      {deleteError ? (
        <p role="alert" className="text-destructive mb-2 flex items-start gap-1 text-xs">
          <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{deleteError}</span>
        </p>
      ) : null}
      <ul className="divide-border divide-y">
        {audioFileIds.map((fileId, i) => (
          <RecordingItem
            key={fileId}
            observationId={observationId}
            audioFileId={fileId}
            title={recordingTitle(recordings[fileId], i)}
            meta={recordings[fileId]}
            observedName={observedName}
            transcript={transcripts[fileId]}
            job={jobsByAudioFileId[fileId]}
            requestError={requestError[fileId]}
            onTranscribe={onTranscribe}
            transcriptionEnabled={transcriptionEnabled}
            readOnly={readOnly}
            onInsert={onInsert}
            isInserted={insertedIds.has(fileId)}
            deleting={deletingId === fileId}
            onDelete={(title) => setConfirmingDelete({ id: fileId, title })}
          />
        ))}
      </ul>
      <Dialog
        open={confirmingDelete !== null}
        onOpenChange={(open) => (open ? null : setConfirmingDelete(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmingDelete?.title ?? 'recording'}?</DialogTitle>
            <DialogDescription>
              The recording and its transcript are removed from this observation, and the audio file
              moves to the Drive trash, where it can be restored for about 30 days.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setConfirmingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              type="button"
              onClick={() => {
                if (confirmingDelete) void handleDelete(confirmingDelete.id);
              }}
            >
              Delete recording
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecordingItem({
  observationId,
  audioFileId,
  title,
  meta,
  observedName,
  transcript,
  job,
  requestError,
  onTranscribe,
  transcriptionEnabled,
  readOnly,
  onInsert,
  isInserted,
  deleting,
  onDelete,
}: {
  observationId: string;
  audioFileId: string;
  title: string;
  meta: AudioRecordingMeta | undefined;
  observedName: string;
  transcript: string | undefined;
  job: TranscriptionJob | undefined;
  requestError: string | undefined;
  onTranscribe: (audioFileId: string) => void;
  transcriptionEnabled: boolean;
  readOnly: boolean;
  onInsert: ((audioFileId: string) => void) | null;
  isInserted: boolean;
  deleting: boolean;
  onDelete: (title: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [busy, setBusy] = useState<null | 'rename' | 'download' | 'drive'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  // Move focus into the name field when Rename opens it.
  useEffect(() => {
    if (renaming) labelInputRef.current?.focus();
  }, [renaming]);

  const isTranscribing = job?.status === 'Pending' || job?.status === 'Running';
  const isFailed = job?.status === 'Failed';
  // A request-time failure (callable rejected outright) takes priority
  // since it means no job doc exists to explain itself. Every message here
  // is about transcription, so none shows when the feature is hidden.
  const errMsg = !transcriptionEnabled
    ? undefined
    : (requestError ?? (isFailed ? (job.error ?? 'Transcription failed') : undefined));

  const details = [formatRecordedAt(meta), formatRecordingDuration(meta?.durationSec)].filter(
    (d): d is string => d !== null,
  );
  const transcriptStatus = !transcriptionEnabled
    ? null
    : transcript
      ? 'transcript ready'
      : isTranscribing
        ? job.status === 'Running'
          ? 'transcribing…'
          : 'queued…'
        : isFailed
          ? 'transcription failed'
          : 'no transcript yet';
  if (transcriptStatus) details.push(transcriptStatus);

  async function run(kind: 'rename' | 'download' | 'drive', action: () => Promise<void>) {
    setBusy(kind);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  function saveLabel() {
    void run('rename', async () => {
      assertWritable();
      await renameRecordingFn({ observationId, audioFileId, label: draftLabel.trim() });
      setRenaming(false);
    });
  }

  function download() {
    void run('download', async () => {
      const blob = await fetchRecordingBlob(observationId, audioFileId);
      saveBlob(
        blob,
        recordingDownloadName({ observedName, meta, title, mimeType: blob.type || 'audio/webm' }),
      );
    });
  }

  function viewInDrive() {
    // Open the tab synchronously (inside the click) so popup blockers allow
    // it, then point it at the link once the callable returns.
    const tab = window.open('', '_blank');
    void run('drive', async () => {
      try {
        assertWritable();
        const { data } = await getRecordingDriveLinkFn({ observationId, audioFileId });
        if (tab) tab.location.href = data.webViewLink;
        else window.open(data.webViewLink, '_blank', 'noopener');
      } catch (err) {
        tab?.close();
        throw err;
      }
    });
  }

  return (
    <li className="py-3">
      {renaming ? (
        <form
          className="mb-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveLabel();
          }}
        >
          <Input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            maxLength={RECORDING_LABEL_MAX}
            placeholder={title}
            aria-label={`Name for ${title}`}
            className="h-8 text-sm"
            ref={labelInputRef}
          />
          <Button type="submit" size="sm" className="h-8" disabled={busy === 'rename'}>
            {busy === 'rename' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setRenaming(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="mb-1">
          <p className="text-sm font-medium">{title}</p>
          {details.length > 0 ? (
            <p className="text-muted-foreground text-xs">{details.join(' · ')}</p>
          ) : null}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={download}
          disabled={busy !== null}
          aria-label={`Download ${title}`}
        >
          {busy === 'download' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          Download
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={viewInDrive}
          disabled={busy !== null}
          aria-label={`View in Drive: ${title}`}
        >
          {busy === 'drive' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ExternalLink className="h-3 w-3" />
          )}
          View in Drive
        </Button>
        {!readOnly ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setDraftLabel(meta?.label ?? '');
                setRenaming(true);
              }}
              disabled={busy !== null || renaming}
              aria-label={`Rename ${title}`}
            >
              <Pencil className="h-3 w-3" />
              Rename
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive h-7 px-2 text-xs"
              onClick={() => onDelete(title)}
              disabled={busy !== null || deleting}
              aria-label={`Delete ${title}`}
            >
              {deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Delete
            </Button>
          </>
        ) : null}
        {!readOnly && transcriptionEnabled ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onTranscribe(audioFileId);
            }}
            disabled={isTranscribing}
            className="h-7 px-2 text-xs"
            title={transcript ? 'Re-transcribe this recording' : 'Generate transcript with Gemini'}
          >
            {isTranscribing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : transcript || isFailed ? (
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

      <RecordingPlayer
        observationId={observationId}
        audioFileId={audioFileId}
        recordingLabel={title}
      />
      {actionError ? (
        <p role="alert" className="text-destructive mt-1 flex items-start gap-1 text-xs">
          <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{actionError}</span>
        </p>
      ) : null}
      {errMsg ? (
        <p className="text-destructive mt-1 flex items-start gap-1 text-xs">
          <AlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{errMsg}</span>
        </p>
      ) : null}
      {transcriptionEnabled && transcript ? (
        <details className="mt-2" open>
          <summary className="text-muted-foreground cursor-pointer text-xs">Transcript</summary>
          <p className="text-foreground mt-1 text-sm whitespace-pre-line">{transcript}</p>
          {!readOnly && onInsert ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onInsert(audioFileId);
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
}

/** Playback speed options offered on each recording — local UI state only,
 *  never persisted (see AI-01 owner notes). */
const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const;
type PlaybackRate = (typeof PLAYBACK_RATES)[number];
const DEFAULT_PLAYBACK_RATE: PlaybackRate = 1;

function RecordingPlayer({
  observationId,
  audioFileId,
  recordingLabel,
}: {
  observationId: string;
  audioFileId: string;
  /** Human-readable label (e.g. "Recording 1") used to scope the playback
   *  speed control's accessible name when multiple players are on screen. */
  recordingLabel: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local to this player only — resets on reload, never written to
  // Firestore or any other persistence layer.
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(DEFAULT_PLAYBACK_RATE);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function loadAudio() {
    setLoading(true);
    setError(null);
    try {
      const blob = await fetchRecordingBlob(observationId, audioFileId);
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

  // Applies the selected rate whenever it changes and whenever a new <audio>
  // element mounts (src loads), since playbackRate resets on element swap.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, src]);

  if (src) {
    return (
      <div className="flex items-center gap-2">
        {/* Autoplay: the element only mounts after the user pressed Play. */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- voice recording, no captions available */}
        <audio ref={audioRef} controls autoPlay src={src} className="w-full min-w-0 flex-1" />
        <select
          value={playbackRate}
          onChange={(e) => {
            setPlaybackRate(Number(e.target.value) as PlaybackRate);
          }}
          aria-label={`Playback speed for ${recordingLabel}`}
          title="Playback speed"
          className="border-input bg-background h-8 shrink-0 rounded-md border px-1.5 text-xs"
        >
          {PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void loadAudio()}
        disabled={loading}
        className={cn('h-7 text-xs', loading && 'opacity-60')}
        aria-label={`Play ${recordingLabel}`}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        Play
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
