import { getIdToken } from 'firebase/auth';
import type { AudioRecordingMeta } from '@ops/shared';
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
