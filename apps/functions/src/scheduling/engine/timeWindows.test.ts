import { describe, expect, it } from 'vitest';
import { intervalsOverlap, peConflicts } from './timeWindows.js';
import type { PeBusyInterval } from '@ops/shared';

/** Build a UTC Date from a Chicago-ish wall clock for readability — tests
 *  only care about relative ms, so we use plain UTC hours here. */
function at(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2025, 2, 10, hour, minute, 0));
}

describe('intervalsOverlap', () => {
  it('detects plain overlap', () => {
    expect(intervalsOverlap(0, 10, 5, 15, 0)).toBe(true);
  });

  it('allows zero-buffer adjacency (touching edges do not overlap)', () => {
    // a ends at 10, b starts at 10
    expect(intervalsOverlap(0, 10, 10, 20, 0)).toBe(false);
  });

  it('buffer turns near-adjacency into a conflict', () => {
    // a:[0,10], b:[12,20], 5ms buffer → conflict
    expect(intervalsOverlap(0, 10, 12, 20, 5)).toBe(true);
    expect(intervalsOverlap(0, 10, 12, 20, 1)).toBe(false);
  });
});

describe('peConflicts (cross-building buffer)', () => {
  const busy: PeBusyInterval[] = [
    { startUTC: at(11, 0), endUTC: at(11, 45), slotId: 'b1-2025-03-10-p3' },
  ];

  it('11:00–11:45 busy + 15-min buffer conflicts with an 11:15 slot start', () => {
    // slot 11:15–12:00 — overlaps directly
    expect(peConflicts(at(11, 15), at(12, 0), busy, 15)).toBe(true);
  });

  it('does NOT conflict with a 9:00 slot', () => {
    expect(peConflicts(at(9, 0), at(9, 45), busy, 15)).toBe(false);
  });

  it('buffer extends conflict to an otherwise-adjacent later slot', () => {
    // slot 11:50–12:35 — 5 min after busy end, within 15-min buffer
    expect(peConflicts(at(11, 50), at(12, 35), busy, 15)).toBe(true);
    // with zero buffer, 11:50 start is clear of an 11:45 end
    expect(peConflicts(at(11, 50), at(12, 35), busy, 0)).toBe(false);
  });

  it('zero-buffer adjacency is allowed', () => {
    // slot 11:45–12:30 starts exactly at busy end
    expect(peConflicts(at(11, 45), at(12, 30), busy, 0)).toBe(false);
  });

  it('skips the ignored slotId', () => {
    const sameSlot: PeBusyInterval[] = [{ startUTC: at(11, 15), endUTC: at(12, 0), slotId: 'me' }];
    expect(peConflicts(at(11, 15), at(12, 0), sameSlot, 15, 'me')).toBe(false);
    expect(peConflicts(at(11, 15), at(12, 0), sameSlot, 15, 'other')).toBe(true);
  });
});
