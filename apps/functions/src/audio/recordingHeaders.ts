/** Parsers for the optional recording-metadata headers uploadAudio accepts. */

/** Longest recording duration accepted from the client header (12 hours). */
const MAX_DURATION_SEC = 12 * 60 * 60;

/** Client-measured duration from `X-Audio-Duration-Sec`; null when absent or
 *  implausible. Display-only metadata, so a bad value is dropped, not refused. */
export function parseDurationSec(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_DURATION_SEC) return null;
  return Math.round(n);
}

/** When the recording started, from `X-Audio-Recorded-At` (ISO 8601). Only
 *  trusted within the last 12 hours (plus a minute of clock skew); otherwise
 *  null and the upload time is used instead. */
export function parseRecordedAt(raw: string | undefined, now: Date = new Date()): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  const skewMs = 60 * 1000;
  if (t > now.getTime() + skewMs || t < now.getTime() - MAX_DURATION_SEC * 1000) return null;
  return new Date(t);
}
