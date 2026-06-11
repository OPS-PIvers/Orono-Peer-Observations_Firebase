import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, isAdminRole } from '@ops/shared';
import { downloadFile, getDriveClient } from '../lib/drive.js';

if (getApps().length === 0) initializeApp();

/** A satisfiable byte range, inclusive of both ends. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse an HTTP `Range` header into an inclusive `{ start, end }` byte range,
 * clamped to a file of `size` bytes. Only a single `bytes=` range is honored —
 * anything else (multi-range, unknown unit, malformed) returns `null` so the
 * caller falls back to serving the full body.
 *
 * Return values:
 *   - `null`           → no/ignorable range; serve the whole file (200).
 *   - `'unsatisfiable'`→ a valid range that starts past EOF (416).
 *   - `ByteRange`      → a concrete range to serve (206).
 *
 * Safari refuses to play `<audio>`/`<video>` unless the server honors Range
 * requests, so this is required for in-app playback, not just an optimization.
 */
export function parseRange(
  rangeHeader: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (!rangeHeader || size <= 0) return null;
  const header = rangeHeader.trim();
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  const hasStart = startRaw !== '';
  const hasEnd = endRaw !== '';

  // A bare "bytes=-" with neither bound is meaningless.
  if (!hasStart && !hasEnd) return null;

  const lastByte = size - 1;

  if (!hasStart) {
    // Suffix range: the final N bytes. Clamp a suffix larger than the file
    // to the whole file rather than rejecting it.
    const suffix = Number(endRaw);
    if (suffix <= 0) return null;
    const start = Math.max(0, size - suffix);
    return { start, end: lastByte };
  }

  const start = Number(startRaw);
  if (start > lastByte) return 'unsatisfiable';

  if (!hasEnd) {
    // Open-ended range: from `start` to EOF.
    return { start, end: lastByte };
  }

  const end = Math.min(Number(endRaw), lastByte);
  if (end < start) return null;
  return { start, end };
}

/**
 * Pull the Firebase ID token from a request. The standard path is the
 * `Authorization: Bearer <token>` header, but a bare `<audio src>` element
 * can't set headers, so we also accept a `token` query parameter as a
 * fallback. The header wins when both are present; a non-Bearer header is
 * ignored in favor of the query token.
 */
export function extractIdToken(args: {
  authHeader: string | undefined;
  tokenQuery: string | undefined;
}): string | null {
  const { authHeader, tokenQuery } = args;
  if (authHeader?.startsWith('Bearer ')) {
    const headerToken = authHeader.slice(7);
    if (headerToken) return headerToken;
  }
  return tokenQuery ?? null;
}

/**
 * Streams an audio file from Drive back to the client. The client uses
 * this in an `<audio>` tag for playback. The SA owns the file, and the
 * client can't read it directly from Drive — we proxy the bytes through.
 *
 * Honors HTTP `Range` requests (206 Partial Content) so Safari, which
 * refuses to play `<audio>` without range support, can stream and seek.
 *
 * GET /getAudio?observationId=<id>&audioFileId=<id>[&token=<idToken>]
 *   Authorization: Bearer <Firebase ID token>   (or ?token= for <audio src>)
 *
 * Authorization: caller must be the observer, an admin, or the observed
 * staff member (when the observation is finalized).
 */
export const getAudio = onRequest(
  {
    region: 'us-central1',
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).send('Method not allowed');
      return;
    }

    const tokenQueryRaw = req.query['token'];
    const idToken = extractIdToken({
      authHeader: req.header('authorization'),
      tokenQuery: typeof tokenQueryRaw === 'string' ? tokenQueryRaw : undefined,
    });
    if (!idToken) {
      res.status(401).send('Missing credentials');
      return;
    }
    let userEmail: string | null = null;
    let role: string | undefined;
    let hasSpecialAccess = false;
    try {
      const decoded = await getAuth().verifyIdToken(idToken);
      userEmail = decoded.email?.toLowerCase() ?? null;
      role = decoded['role'] as string | undefined;
      hasSpecialAccess = decoded['hasSpecialAccess'] === true;
    } catch (err) {
      logger.warn('getAudio: invalid token', err);
      res.status(401).send('Invalid token');
      return;
    }
    if (!userEmail) {
      res.status(401).send('Token has no email');
      return;
    }

    const observationIdRaw = req.query['observationId'];
    const audioFileIdRaw = req.query['audioFileId'];
    const observationId = typeof observationIdRaw === 'string' ? observationIdRaw : '';
    const audioFileId = typeof audioFileIdRaw === 'string' ? audioFileIdRaw : '';
    if (!observationId || !audioFileId) {
      res.status(400).send('Missing observationId or audioFileId');
      return;
    }

    const db = getFirestore();
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const obsSnap = await obsRef.get();
    if (!obsSnap.exists) {
      res.status(404).send('Observation not found');
      return;
    }
    const obs = obsSnap.data() as {
      observerEmail: string;
      observedEmail: string;
      status: string;
      audioDriveFileIds: string[];
    };
    if (!obs.audioDriveFileIds.includes(audioFileId)) {
      res.status(404).send('Audio file is not part of this observation');
      return;
    }

    const isAdmin = isAdminRole(role ?? null) || hasSpecialAccess;
    const isObserver = obs.observerEmail === userEmail;
    const isObservedFinalized =
      obs.observedEmail === userEmail && obs.status === OBSERVATION_STATUS.finalized;
    if (!isAdmin && !isObserver && !isObservedFinalized) {
      res.status(403).send('Not authorized to access this audio');
      return;
    }

    try {
      const drive = getDriveClient();
      const meta = await drive.files.get({
        fileId: audioFileId,
        fields: 'mimeType, name',
        supportsAllDrives: true,
      });
      const buffer = await downloadFile(audioFileId);
      const contentType = meta.data.mimeType ?? 'audio/webm';
      const fileName = meta.data.name ?? 'audio.webm';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Accept-Ranges', 'bytes');

      const range = parseRange(req.header('range'), buffer.length);
      if (range === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${String(buffer.length)}`);
        res.status(416).send('Requested range not satisfiable');
        return;
      }
      if (range) {
        const slice = buffer.subarray(range.start, range.end + 1);
        res.setHeader(
          'Content-Range',
          `bytes ${String(range.start)}-${String(range.end)}/${String(buffer.length)}`,
        );
        res.setHeader('Content-Length', String(slice.length));
        res.status(206).send(slice);
        return;
      }

      res.setHeader('Content-Length', String(buffer.length));
      res.status(200).send(buffer);
    } catch (err) {
      logger.error('getAudio: failed', err);
      res.status(500).send('Failed to fetch audio');
    }
  },
);
