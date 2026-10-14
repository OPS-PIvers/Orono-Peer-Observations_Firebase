import { getIdToken } from 'firebase/auth';
import {
  AUDIO_UPLOAD_CHUNK_BYTES,
  MAX_AUDIO_UPLOAD_BYTES,
  type AudioRecordingMeta,
} from '@ops/shared';
import { auth, functionsHttpUrl } from '@/lib/firebase';
import { toJsDate } from '@/utils/staffFormatting';

/** Display name for a recording: its label, else its position in the list. */
export function recordingTitle(meta: AudioRecordingMeta | undefined, index: number): string {
  const label = meta?.label.trim();
  if (label) return label;
  return `Recording ${String(index + 1)}`;
}

/** "Sep 30, 2026, 9:14 AM", or null when the time isn't known yet. */
export function formatRecordedAt(meta: AudioRecordingMeta | undefined): string | null {
  const date = toJsDate(meta?.recordedAt);
  if (!date) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "4:05" / "1:02:09", or null when the duration isn't known. */
export function formatRecordingDuration(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

/** Characters Windows, macOS and Drive all accept in a file name. */
function fileNamePart(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Extension for a recording blob's MIME type (mirrors uploadAudio's). */
export function audioExtension(mimeType: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

/** `<teacher>-<yyyy-mm-dd>-<label>.<ext>`, e.g. `Jane-Doe-2026-09-30-Recording-1.webm`. */
export function recordingDownloadName(args: {
  observedName: string;
  meta: AudioRecordingMeta | undefined;
  title: string;
  mimeType: string;
}): string {
  const date = toJsDate(args.meta?.recordedAt);
  const ymd = date
    ? `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : '';
  const stem = [args.observedName, ymd, args.title].map(fileNamePart).filter(Boolean).join('-');
  return `${stem || 'recording'}.${audioExtension(args.mimeType)}`;
}

/** Fetch a recording's bytes through the getAudio proxy (the file itself
 *  lives in a Drive folder the browser can't read directly). */
export async function fetchRecordingBlob(
  observationId: string,
  audioFileId: string,
): Promise<Blob> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const idToken = await getIdToken(user);
  const url = `${functionsHttpUrl('getAudio')}?observationId=${encodeURIComponent(observationId)}&audioFileId=${encodeURIComponent(audioFileId)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
  if (!response.ok) throw new Error(`Fetch failed: ${String(response.status)}`);
  return response.blob();
}

/** Save a blob to the user's device under `fileName`. */
export function saveBlob(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later, not immediately: Safari can still be reading the blob URL
  // after click() returns.
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

/** Waits between attempts when a piece of an upload can't reach the server
 *  (school Wi-Fi blip, laptop lid closed mid-upload). */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

/** The server answered, but with an error status (as opposed to the request
 *  never arriving). Only 5xx are worth retrying. */
class UploadHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UploadHttpError';
  }
}

type PieceResponse =
  { status: 'incomplete'; uploadSession: string; received: number } | { audioFileId: string };

/**
 * Send audio to the `uploadAudio` function, which stores it in the
 * observation's Drive folder and adds the recording to the observation.
 * Used by in-app recordings and by imports from Drive alike.
 *
 * The audio goes in pieces of AUDIO_UPLOAD_CHUNK_BYTES: one request can't be
 * over 32 MiB, and a class period recorded in the browser is bigger than
 * that. A piece that can't reach the server is retried after a pause, and the
 * upload resumes from wherever Drive says it got to, so a dropped connection
 * or a laptop going to sleep mid-upload doesn't lose the recording.
 */
export async function uploadObservationAudio(args: {
  observationId: string;
  blob: Blob;
  mimeType: string;
  recordedAt?: Date | null;
  durationSec?: number | null;
  /** Fraction of the bytes Drive has, 0 to 1, after each piece. */
  onProgress?: (fraction: number) => void;
}): Promise<{ audioFileId: string }> {
  const total = args.blob.size;
  if (total > MAX_AUDIO_UPLOAD_BYTES) {
    const mb = (total / (1024 * 1024)).toFixed(0);
    const max = String(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024));
    throw new Error(`The audio is too large to upload (${mb} MB; the limit is ${max} MB).`);
  }
  let session: string | null = null;
  let offset = 0;
  let failures = 0;
  for (;;) {
    try {
      // After a failed piece we don't know whether Drive got it, so ask
      // (an empty piece) before sending more.
      const resuming = failures > 0 && session !== null;
      const piece = resuming
        ? new Blob([])
        : args.blob.slice(offset, Math.min(offset + AUDIO_UPLOAD_CHUNK_BYTES, total));
      const result = await postPiece(args, piece, offset, total, session);
      if ('audioFileId' in result) {
        args.onProgress?.(1);
        return { audioFileId: result.audioFileId };
      }
      session = result.uploadSession;
      offset = result.received;
      failures = 0;
      args.onProgress?.(offset / total);
    } catch (err) {
      if (err instanceof UploadHttpError && err.status === 410) {
        // Drive forgot the session: start over from the first byte.
        session = null;
        offset = 0;
      } else if (err instanceof UploadHttpError && err.status < 500) {
        throw err;
      }
      const delay = RETRY_DELAYS_MS[failures];
      if (delay === undefined) throw friendlyUploadError(err);
      failures += 1;
      await waitToRetry(delay);
    }
  }
}

async function postPiece(
  args: {
    observationId: string;
    mimeType: string;
    recordedAt?: Date | null;
    durationSec?: number | null;
  },
  piece: Blob,
  offset: number,
  total: number,
  session: string | null,
): Promise<PieceResponse> {
  const user = auth.currentUser;
  if (!user) throw new UploadHttpError(401, 'Not signed in.');
  const idToken = await getIdToken(user);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${idToken}`,
    'X-Observation-Id': args.observationId,
    'X-Audio-Mime-Type': args.mimeType,
    'Content-Type': args.mimeType,
    'X-Upload-Total-Bytes': String(total),
    'X-Upload-Offset': String(offset),
  };
  if (session) headers['X-Upload-Session'] = session;
  if (args.recordedAt) headers['X-Audio-Recorded-At'] = args.recordedAt.toISOString();
  if (args.durationSec != null) headers['X-Audio-Duration-Sec'] = String(args.durationSec);
  const response = await fetch(functionsHttpUrl('uploadAudio'), {
    method: 'POST',
    headers,
    body: piece,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new UploadHttpError(
      response.status,
      `Upload failed (${String(response.status)}): ${text || response.statusText}`,
    );
  }
  return (await response.json()) as PieceResponse;
}

/** Pause before a retry, and if the browser is offline (lid just opened, Wi-Fi
 *  reconnecting) keep waiting until it's back, for up to a minute. */
async function waitToRetry(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  if (navigator.onLine) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      window.removeEventListener('online', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 60_000);
    window.addEventListener('online', done);
  });
}

/** fetch's own "Failed to fetch" says nothing useful to a teacher. */
function friendlyUploadError(err: unknown): Error {
  if (err instanceof UploadHttpError) return err;
  return new Error("Couldn't reach the server to upload the audio. Check the internet connection.");
}
