import { describe, expect, it } from 'vitest';
import type { RateLimitCounter } from './rateLimit.js';

// Set fake env to satisfy the Firebase Admin/Functions initializers that may
// run at module scope before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const { decideRateLimit, rateLimitsFromSettings, rateLimitCounterId, RATE_LIMIT_KEYS } =
  await import('./rateLimit.js');

// A minimal Timestamp stand-in: decideRateLimit only calls .toMillis().
function ts(ms: number): RateLimitCounter['windowStart'] {
  return { toMillis: () => ms } as unknown as RateLimitCounter['windowStart'];
}

const WINDOW = 60_000;
const MAX = 3;

describe('decideRateLimit', () => {
  it('allows and counts the first request when no counter exists', () => {
    const { decision, nextCount, windowStartMs } = decideRateLimit(null, MAX, WINDOW, 1_000);
    expect(decision.allowed).toBe(true);
    expect(nextCount).toBe(1);
    expect(windowStartMs).toBe(1_000); // window anchored at now
    expect(decision.remaining).toBe(MAX - 1);
    expect(decision.resetAtMs).toBe(1_000 + WINDOW);
  });

  it('increments within the same window and keeps the original windowStart', () => {
    const existing: RateLimitCounter = { count: 1, windowStart: ts(1_000) };
    const { decision, nextCount, windowStartMs } = decideRateLimit(
      existing,
      MAX,
      WINDOW,
      1_000 + 5_000,
    );
    expect(decision.allowed).toBe(true);
    expect(nextCount).toBe(2);
    expect(windowStartMs).toBe(1_000); // unchanged within the window
    expect(decision.remaining).toBe(MAX - 2);
  });

  it('denies the request that would exceed max and does not increment', () => {
    const existing: RateLimitCounter = { count: MAX, windowStart: ts(1_000) };
    const { decision, nextCount } = decideRateLimit(existing, MAX, WINDOW, 1_000 + 5_000);
    expect(decision.allowed).toBe(false);
    expect(nextCount).toBe(MAX); // unchanged — denied requests don't count
    expect(decision.remaining).toBe(0);
  });

  it('resets to a fresh window once the prior window has fully elapsed', () => {
    const existing: RateLimitCounter = { count: MAX, windowStart: ts(1_000) };
    const now = 1_000 + WINDOW; // exactly at the boundary → window elapsed
    const { decision, nextCount, windowStartMs } = decideRateLimit(existing, MAX, WINDOW, now);
    expect(decision.allowed).toBe(true);
    expect(nextCount).toBe(1); // counter reset
    expect(windowStartMs).toBe(now); // re-anchored at now
    expect(decision.resetAtMs).toBe(now + WINDOW);
  });

  it('treats a non-positive max as a hard disable (never allowed)', () => {
    const { decision, nextCount } = decideRateLimit(null, 0, WINDOW, 1_000);
    expect(decision.allowed).toBe(false);
    expect(nextCount).toBe(0);
    expect(decision.remaining).toBe(0);
  });

  it('allows exactly up to max across a sequence then denies', () => {
    let counter: RateLimitCounter | null = null;
    const results: boolean[] = [];
    for (let i = 0; i < MAX + 2; i += 1) {
      const { decision, nextCount, windowStartMs } = decideRateLimit(
        counter,
        MAX,
        WINDOW,
        1_000 + i, // all within one window
      );
      results.push(decision.allowed);
      counter = { count: nextCount, windowStart: ts(windowStartMs) };
    }
    // First MAX requests allowed, the rest denied.
    expect(results).toEqual([true, true, true, false, false]);
  });
});

describe('rateLimitCounterId', () => {
  it('combines email and key without a forbidden separator', () => {
    const id = rateLimitCounterId('pe@orono.k12.mn.us', RATE_LIMIT_KEYS.audioUpload);
    expect(id).toBe('pe@orono.k12.mn.us__audioUpload');
    expect(id).not.toContain('/');
  });

  it('produces distinct ids per key for the same user', () => {
    const a = rateLimitCounterId('pe@orono.k12.mn.us', RATE_LIMIT_KEYS.audioUpload);
    const b = rateLimitCounterId('pe@orono.k12.mn.us', RATE_LIMIT_KEYS.transcription);
    expect(a).not.toBe(b);
  });
});

describe('rateLimitsFromSettings', () => {
  it('applies schema defaults for an empty/missing value', () => {
    expect(rateLimitsFromSettings(undefined)).toEqual({
      observationSavesPerMinute: 60,
      audioUploadsPerHour: 20,
      transcriptionRequestsPerDay: 50,
    });
    expect(rateLimitsFromSettings({})).toEqual({
      observationSavesPerMinute: 60,
      audioUploadsPerHour: 20,
      transcriptionRequestsPerDay: 50,
    });
  });

  it('respects admin overrides', () => {
    expect(
      rateLimitsFromSettings({
        observationSavesPerMinute: 10,
        audioUploadsPerHour: 5,
        transcriptionRequestsPerDay: 2,
      }),
    ).toEqual({
      observationSavesPerMinute: 10,
      audioUploadsPerHour: 5,
      transcriptionRequestsPerDay: 2,
    });
  });

  it('falls back to defaults when an override is invalid (non-positive)', () => {
    // observationSavesPerMinute must be a positive int; a 0 fails the schema,
    // so the whole object falls back to defaults rather than throwing.
    expect(rateLimitsFromSettings({ observationSavesPerMinute: 0 })).toEqual({
      observationSavesPerMinute: 60,
      audioUploadsPerHour: 20,
      transcriptionRequestsPerDay: 50,
    });
  });
});
