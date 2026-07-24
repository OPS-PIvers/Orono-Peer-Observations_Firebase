import { describe, expect, it } from 'vitest';
import { toDate } from './toDate.js';

/** Minimal stand-in for a Firestore Timestamp (and any other `.toDate()` duck). */
function fakeTimestamp(date: Date) {
  return { toDate: () => date };
}

describe('toDate', () => {
  it('passes through an existing Date instance', () => {
    const d = new Date('2026-03-10T12:00:00Z');
    expect(toDate(d)).toBe(d);
  });

  it('coerces a Firestore-Timestamp-like value via .toDate()', () => {
    const d = new Date('2026-03-10T12:00:00Z');
    expect(toDate(fakeTimestamp(d))).toEqual(d);
  });

  it('returns null when .toDate() throws or returns a non-Date', () => {
    expect(
      toDate({
        toDate: () => {
          throw new Error('boom');
        },
      }),
    ).toBeNull();
    expect(toDate({ toDate: () => 'not-a-date' })).toBeNull();
  });

  it('parses an ISO string', () => {
    expect(toDate('2026-03-10T12:00:00Z')).toEqual(new Date('2026-03-10T12:00:00Z'));
  });

  it('returns null for an unparseable string', () => {
    expect(toDate('not a date')).toBeNull();
  });

  it('parses an epoch-ms number', () => {
    const ms = Date.parse('2026-03-10T12:00:00Z');
    expect(toDate(ms)).toEqual(new Date(ms));
  });

  it('returns null for NaN', () => {
    expect(toDate(NaN)).toBeNull();
  });

  it('returns null for null, undefined, and unrecognized shapes', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate({})).toBeNull();
    expect(toDate(true)).toBeNull();
  });
});
