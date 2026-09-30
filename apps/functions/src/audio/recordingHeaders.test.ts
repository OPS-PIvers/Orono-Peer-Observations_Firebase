import { describe, expect, it } from 'vitest';
import { parseDurationSec, parseRecordedAt } from './recordingHeaders.js';

describe('parseDurationSec', () => {
  it('rounds a plausible duration to whole seconds', () => {
    expect(parseDurationSec('93.6')).toBe(94);
    expect(parseDurationSec('0')).toBe(0);
  });

  it('drops missing, malformed, negative and implausibly long values', () => {
    expect(parseDurationSec(undefined)).toBeNull();
    expect(parseDurationSec('')).toBeNull();
    expect(parseDurationSec('abc')).toBeNull();
    expect(parseDurationSec('-5')).toBeNull();
    expect(parseDurationSec(String(13 * 60 * 60))).toBeNull();
  });
});

describe('parseRecordedAt', () => {
  const now = new Date('2026-09-30T16:00:00.000Z');

  it('accepts a start time from earlier today', () => {
    expect(parseRecordedAt('2026-09-30T15:10:00.000Z', now)).toEqual(
      new Date('2026-09-30T15:10:00.000Z'),
    );
  });

  it('allows a minute of clock skew into the future', () => {
    expect(parseRecordedAt('2026-09-30T16:00:30.000Z', now)).not.toBeNull();
    expect(parseRecordedAt('2026-09-30T16:05:00.000Z', now)).toBeNull();
  });

  it('rejects malformed and stale times', () => {
    expect(parseRecordedAt(undefined, now)).toBeNull();
    expect(parseRecordedAt('yesterday', now)).toBeNull();
    expect(parseRecordedAt('2026-09-29T02:00:00.000Z', now)).toBeNull();
  });
});
