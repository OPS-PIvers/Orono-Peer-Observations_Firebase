import { describe, expect, it } from 'vitest';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in getAudio.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { parseRange, extractIdToken } = await import('./getAudio.js');

describe('parseRange', () => {
  const SIZE = 1000;

  it('returns null when no Range header is present', () => {
    expect(parseRange(undefined, SIZE)).toBeNull();
  });

  it('returns null for an empty Range header', () => {
    expect(parseRange('', SIZE)).toBeNull();
  });

  it('parses a closed range', () => {
    expect(parseRange('bytes=0-499', SIZE)).toEqual({ start: 0, end: 499 });
  });

  it("parses an open-ended range (Safari's initial probe)", () => {
    expect(parseRange('bytes=0-', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('parses a mid-file open-ended range (a seek)', () => {
    expect(parseRange('bytes=500-', SIZE)).toEqual({ start: 500, end: 999 });
  });

  it('parses a suffix range (final N bytes)', () => {
    expect(parseRange('bytes=-200', SIZE)).toEqual({ start: 800, end: 999 });
  });

  it('clamps a suffix larger than the file to the whole file', () => {
    expect(parseRange('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999 });
  });

  it('clamps an end past EOF to the last byte', () => {
    expect(parseRange('bytes=900-5000', SIZE)).toEqual({ start: 900, end: 999 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseRange('  bytes=0-10  ', SIZE)).toEqual({ start: 0, end: 10 });
  });

  it('reports a start past EOF as unsatisfiable', () => {
    expect(parseRange('bytes=1000-1100', SIZE)).toBe('unsatisfiable');
  });

  it('returns null for a malformed range', () => {
    expect(parseRange('bytes=abc-def', SIZE)).toBeNull();
  });

  it('returns null for a non-bytes unit', () => {
    expect(parseRange('items=0-10', SIZE)).toBeNull();
  });

  it('returns null for a multi-range request (falls back to full body)', () => {
    expect(parseRange('bytes=0-10,20-30', SIZE)).toBeNull();
  });

  it('returns null for an inverted range', () => {
    expect(parseRange('bytes=500-100', SIZE)).toBeNull();
  });

  it('returns null when size is zero or negative', () => {
    expect(parseRange('bytes=0-10', 0)).toBeNull();
  });
});

describe('extractIdToken', () => {
  it('prefers the Authorization: Bearer header', () => {
    expect(extractIdToken({ authHeader: 'Bearer header-token', tokenQuery: 'query-token' })).toBe(
      'header-token',
    );
  });

  it('falls back to the token query parameter for <audio src>', () => {
    expect(extractIdToken({ authHeader: undefined, tokenQuery: 'query-token' })).toBe(
      'query-token',
    );
  });

  it('ignores a non-Bearer Authorization header and uses the query token', () => {
    expect(extractIdToken({ authHeader: 'Basic abc', tokenQuery: 'query-token' })).toBe(
      'query-token',
    );
  });

  it('returns null when no credentials are present', () => {
    expect(extractIdToken({ authHeader: undefined, tokenQuery: undefined })).toBeNull();
  });

  it('returns null for a bare Bearer header with no token and no query', () => {
    // "Bearer " with an empty token slices to '' which is falsy → no query → null.
    expect(extractIdToken({ authHeader: 'Bearer ', tokenQuery: undefined })).toBeNull();
  });
});
