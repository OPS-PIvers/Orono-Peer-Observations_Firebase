import { logger } from 'firebase-functions';
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import { APP_SETTINGS_DOC_ID, COLLECTIONS, rateLimits, type RateLimits } from '@ops/shared';

/**
 * Server-only collection holding per-user fixed-window rate-limit counters.
 * One doc per (userEmail, key) pair (see {@link rateLimitCounterId}). Clients
 * are denied all access in firestore.rules — only the Admin SDK writes here.
 *
 * Not added to the shared COLLECTIONS map because it's an implementation detail
 * of this module that no other workspace references.
 */
export const RATE_LIMIT_COUNTERS_COLLECTION = 'rateLimitCounters';

/** The rate-limited operations we count, keyed for the counter doc id. */
export const RATE_LIMIT_KEYS = {
  audioUpload: 'audioUpload',
  transcription: 'transcription',
} as const;

export type RateLimitKey = (typeof RATE_LIMIT_KEYS)[keyof typeof RATE_LIMIT_KEYS];

/**
 * Counter doc id for a (userEmail, key) pair. Emails are lowercased upstream;
 * `/` is the only character Firestore forbids in a doc id and never appears in
 * an email local-part or our static keys, so a simple join is collision-free.
 */
export function rateLimitCounterId(userEmail: string, key: RateLimitKey): string {
  return `${userEmail}__${key}`;
}

/** Shape persisted in a counter doc. `windowStart` anchors the fixed window. */
export interface RateLimitCounter {
  count: number;
  windowStart: Timestamp;
}

/**
 * The minimal transaction surface checkRateLimit needs. Kept narrow so the
 * compare-and-increment can be unit-tested with a fake transaction; the real
 * firebase-admin `Transaction` satisfies this shape.
 */
export interface RateLimitTx {
  get(ref: DocumentReference): Promise<DocumentSnapshot>;
  set(ref: DocumentReference, data: Record<string, unknown>): void;
}

export interface RateLimitDecision {
  /** True when the operation is within the limit (and was counted). */
  allowed: boolean;
  /** Requests remaining in the current window after this one (>= 0). */
  remaining: number;
  /** When the current window resets (ms since epoch). */
  resetAtMs: number;
}

/**
 * Pure fixed-window decision: given the existing counter (or null), the limit,
 * the window length and the current time, decide whether one more operation is
 * allowed and compute the counter's next state.
 *
 * Fixed-window semantics: the first request in a window stamps `windowStart`;
 * subsequent requests within `windowMs` increment the same counter; once the
 * window elapses the counter resets to a fresh window starting at `nowMs`.
 *
 * A non-positive `max` disables the operation entirely (never allowed) — but
 * callers load limits through {@link rateLimitsFromSettings}, which applies the
 * schema's positive defaults, so this only bites a deliberately-zeroed config.
 *
 * Extracted from the transaction so it can be unit-tested without an emulator.
 */
export function decideRateLimit(
  existing: RateLimitCounter | null,
  max: number,
  windowMs: number,
  nowMs: number,
): { decision: RateLimitDecision; nextCount: number; windowStartMs: number } {
  const inWindow =
    existing !== null && nowMs - existing.windowStart.toMillis() < windowMs;
  const windowStartMs = inWindow ? existing.windowStart.toMillis() : nowMs;
  const priorCount = inWindow ? existing.count : 0;
  const allowed = priorCount < max;
  const nextCount = allowed ? priorCount + 1 : priorCount;
  const remaining = Math.max(0, max - nextCount);
  return {
    decision: { allowed, remaining, resetAtMs: windowStartMs + windowMs },
    nextCount,
    windowStartMs,
  };
}

export interface RateLimitOpts {
  userEmail: string;
  key: RateLimitKey;
  max: number;
  windowMs: number;
  now?: number;
}

/**
 * Apply the limiter inside a caller-provided transaction. Reads the counter
 * doc, applies {@link decideRateLimit}, and — only when allowed — writes the
 * incremented count. A denied request leaves the doc untouched so a client that
 * keeps hammering can't push the window forward and starve itself; the window
 * still resets on its own schedule.
 *
 * Sharing the caller's transaction lets a limiter that must be atomic with
 * other writes (e.g. "count this only when a new transcription job is created")
 * stay consistent — the increment and the gated write commit together.
 */
export async function checkRateLimitInTransaction(
  tx: RateLimitTx,
  ref: DocumentReference,
  opts: RateLimitOpts,
): Promise<RateLimitDecision> {
  const nowMs = opts.now ?? Date.now();
  const snap = await tx.get(ref);
  const existing = readCounter(snap);
  const { decision, nextCount, windowStartMs } = decideRateLimit(
    existing,
    opts.max,
    opts.windowMs,
    nowMs,
  );
  if (decision.allowed) {
    tx.set(ref, {
      count: nextCount,
      windowStart: Timestamp.fromMillis(windowStartMs),
      userEmail: opts.userEmail,
      key: opts.key,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return decision;
}

/** Doc ref for a (userEmail, key) counter. */
export function rateLimitCounterRef(db: Firestore, opts: RateLimitOpts): DocumentReference {
  return db
    .collection(RATE_LIMIT_COUNTERS_COLLECTION)
    .doc(rateLimitCounterId(opts.userEmail, opts.key));
}

/**
 * Transactionally enforce a per-user fixed-window rate limit in its own
 * transaction. Convenience wrapper around {@link checkRateLimitInTransaction}
 * for callers (e.g. uploadAudio) that have no other writes to make atomic.
 *
 * Returns the decision; the caller turns a `!allowed` result into the
 * appropriate transport error (HTTP 429 / failed-precondition).
 */
export async function checkRateLimit(
  db: Firestore,
  opts: RateLimitOpts,
): Promise<RateLimitDecision> {
  const ref = rateLimitCounterRef(db, opts);
  return db.runTransaction((tx) => checkRateLimitInTransaction(tx, ref, opts));
}

/** Parse a counter snapshot into the typed shape, tolerating malformed docs. */
function readCounter(snap: DocumentSnapshot): RateLimitCounter | null {
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown> | undefined;
  const count: unknown = data?.['count'];
  const windowStart: unknown = data?.['windowStart'];
  if (typeof count !== 'number' || !(windowStart instanceof Timestamp)) return null;
  return { count, windowStart };
}

/**
 * Read the admin-configured rate limits from /appSettings/global, applying the
 * shared Zod schema defaults. Firestore reads bypass Zod, so a missing doc or a
 * partially-populated `rateLimits` object falls back to the schema defaults
 * (60 saves/min, 20 uploads/hr, 50 transcriptions/day) rather than throwing.
 */
export async function loadRateLimits(db: Firestore): Promise<RateLimits> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const raw = snap.exists ? (snap.data()?.['rateLimits'] as unknown) : undefined;
  return rateLimitsFromSettings(raw);
}

/**
 * Coerce a raw `rateLimits` value (or anything) into a fully-defaulted
 * {@link RateLimits}. A parse failure (e.g. a non-positive override an admin
 * typed past the form min) falls back to schema defaults so enforcement never
 * crashes the caller.
 */
export function rateLimitsFromSettings(raw: unknown): RateLimits {
  const parsed = rateLimits.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  logger.warn('rateLimit: invalid rateLimits in settings, using defaults', {
    error: parsed.error.message,
  });
  return rateLimits.parse({});
}
