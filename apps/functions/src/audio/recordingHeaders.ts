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

/**
 * What an uploadAudio request is, from its `X-Upload-*` headers:
 *  - `whole`: the entire file in one request (clients from before chunked
 *    uploads; capped at 32 MiB by Cloud Functions).
 *  - `chunk`: one piece of a resumable upload. `session` is null on the first
 *    piece, which opens the Drive upload. An empty body with a session asks
 *    how many bytes Drive has, so a client can resume after a lost response.
 */
export type UploadRequest =
  | { kind: 'whole' }
  | { kind: 'chunk'; totalBytes: number; offset: number; session: string | null }
  | { kind: 'invalid'; status: 400 | 413; reason: string };

export function parseUploadRequest(
  headers: { total: string | undefined; offset: string | undefined; session: string | undefined },
  bodyLength: number,
  maxBytes: number,
): UploadRequest {
  if (headers.total === undefined) return { kind: 'whole' };
  const totalBytes = parseNonNegativeInt(headers.total);
  if (totalBytes === null || totalBytes === 0) {
    return { kind: 'invalid', status: 400, reason: 'Bad X-Upload-Total-Bytes' };
  }
  if (totalBytes > maxBytes) {
    const mb = String(Math.round(maxBytes / (1024 * 1024)));
    return { kind: 'invalid', status: 413, reason: `Audio is larger than the ${mb} MB limit` };
  }
  const offset = parseNonNegativeInt(headers.offset ?? '');
  if (offset === null || offset + bodyLength > totalBytes) {
    return { kind: 'invalid', status: 400, reason: 'Bad X-Upload-Offset' };
  }
  const session = headers.session?.trim() ? headers.session.trim() : null;
  if (session === null && (offset !== 0 || bodyLength === 0)) {
    return { kind: 'invalid', status: 400, reason: 'The first piece must start at byte 0' };
  }
  return { kind: 'chunk', totalBytes, offset, session };
}

function parseNonNegativeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
