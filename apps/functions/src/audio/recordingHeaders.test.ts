import { describe, expect, it } from 'vitest';
import { parseDurationSec, parseRecordedAt, parseUploadRequest } from './recordingHeaders.js';

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

describe('parseUploadRequest', () => {
  const MAX = 100;
  const parse = (h: { total?: string; offset?: string; session?: string }, bodyLength: number) =>
    parseUploadRequest({ total: h.total, offset: h.offset, session: h.session }, bodyLength, MAX);

  it('treats a request without X-Upload-Total-Bytes as a whole-file upload', () => {
    expect(parse({}, 10)).toEqual({ kind: 'whole' });
  });

  it('reads the first piece, which has no session yet', () => {
    expect(parse({ total: '80', offset: '0' }, 32)).toEqual({
      kind: 'chunk',
      totalBytes: 80,
      offset: 0,
      session: null,
    });
  });

  it('reads a later piece and an empty status query', () => {
    expect(parse({ total: '80', offset: '32', session: ' https://s ' }, 32)).toEqual({
      kind: 'chunk',
      totalBytes: 80,
      offset: 32,
      session: 'https://s',
    });
    expect(parse({ total: '80', offset: '0', session: 'https://s' }, 0)).toMatchObject({
      kind: 'chunk',
    });
  });

  it('refuses files over the cap with 413', () => {
    expect(parse({ total: '101', offset: '0' }, 10)).toMatchObject({
      kind: 'invalid',
      status: 413,
    });
  });

  it('refuses malformed sizes and offsets', () => {
    for (const h of [
      { total: '0', offset: '0' },
      { total: '-5', offset: '0' },
      { total: '1e3', offset: '0' },
      { total: '80', offset: 'x' },
      { total: '80' },
      { total: '80', offset: '60', session: 'https://s' },
    ]) {
      expect(parse(h, 32)).toMatchObject({ kind: 'invalid', status: 400 });
    }
  });

  it('requires the first piece to start at 0 and carry bytes', () => {
    expect(parse({ total: '80', offset: '32' }, 32)).toMatchObject({ kind: 'invalid' });
    expect(parse({ total: '80', offset: '0' }, 0)).toMatchObject({ kind: 'invalid' });
  });
});
