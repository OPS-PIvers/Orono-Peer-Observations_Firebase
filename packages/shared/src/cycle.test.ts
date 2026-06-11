import { describe, expect, it } from 'vitest';
import {
  CYCLE_STATUSES,
  advanceCycle,
  cycleStatus,
  displayYear,
  schoolYearStart,
} from './cycle.js';

describe('CYCLE_STATUSES', () => {
  it('is the three statuses in order', () => {
    expect(CYCLE_STATUSES).toEqual(['low', 'high', 'probationary']);
  });
});

describe('displayYear', () => {
  it('passes continuing years through and maps probationary 4-6 to 1-3', () => {
    expect(displayYear(1)).toBe(1);
    expect(displayYear(3)).toBe(3);
    expect(displayYear(4)).toBe(1);
    expect(displayYear(6)).toBe(3);
  });
});

describe('cycleStatus', () => {
  it('is probationary for year >= 4 regardless of summative', () => {
    expect(cycleStatus(4, false)).toBe('probationary');
    expect(cycleStatus(6, true)).toBe('probationary');
  });
  it('is high when summative, low otherwise, for continuing years', () => {
    expect(cycleStatus(2, true)).toBe('high');
    expect(cycleStatus(2, false)).toBe('low');
  });
});

describe('schoolYearStart', () => {
  it('anchors fall dates to Aug 1 of the same calendar year', () => {
    expect(schoolYearStart(new Date(2025, 8, 15))).toEqual(new Date(2025, 7, 1));
    expect(schoolYearStart(new Date(2025, 11, 31))).toEqual(new Date(2025, 7, 1));
  });

  it('anchors spring dates to Aug 1 of the previous calendar year', () => {
    expect(schoolYearStart(new Date(2026, 0, 5))).toEqual(new Date(2025, 7, 1));
    expect(schoolYearStart(new Date(2026, 4, 15))).toEqual(new Date(2025, 7, 1));
  });

  it('rolls over exactly on Aug 1 — July 31 is still the prior year', () => {
    expect(schoolYearStart(new Date(2026, 6, 31, 23, 59))).toEqual(new Date(2025, 7, 1));
    expect(schoolYearStart(new Date(2026, 7, 1))).toEqual(new Date(2026, 7, 1));
  });
});

describe('advanceCycle', () => {
  it('walks continuing years Y1→Y2→Y3→Y1', () => {
    expect(advanceCycle({ year: 1, summativeYear: false })).toEqual({
      year: 2,
      summativeYear: false,
    });
    expect(advanceCycle({ year: 2, summativeYear: false })).toEqual({
      year: 3,
      summativeYear: true,
    });
    expect(advanceCycle({ year: 3, summativeYear: true })).toEqual({
      year: 1,
      summativeYear: false,
    });
  });

  it('makes Year 3 the high-cycle (summative) year and resets to low cycle at Year 1', () => {
    // Landing on Year 3 is always summative…
    expect(advanceCycle({ year: 2, summativeYear: false }).summativeYear).toBe(true);
    // …and leaving Year 3 resets to a low-cycle Year 1.
    expect(advanceCycle({ year: 3, summativeYear: true })).toEqual({
      year: 1,
      summativeYear: false,
    });
  });

  it('re-derives summative from the new year, discarding a stale hand-edited flag', () => {
    // A continuing Y1 marked summative by hand still advances to a non-summative Y2.
    expect(advanceCycle({ year: 1, summativeYear: true })).toEqual({
      year: 2,
      summativeYear: false,
    });
    // A continuing Y2 not marked summative still becomes a summative Y3.
    expect(advanceCycle({ year: 2, summativeYear: false }).summativeYear).toBe(true);
  });

  it('advances probationary P1→P2→P3, keeping summative true', () => {
    expect(advanceCycle({ year: 4, summativeYear: true })).toEqual({
      year: 5,
      summativeYear: true,
    });
    expect(advanceCycle({ year: 5, summativeYear: true })).toEqual({
      year: 6,
      summativeYear: true,
    });
  });

  it('graduates P3 to a continuing-contract low-cycle Year 1', () => {
    expect(advanceCycle({ year: 6, summativeYear: true })).toEqual({
      year: 1,
      summativeYear: false,
    });
  });

  it('clamps out-of-range stored years into a valid result', () => {
    // Below range (continuing) is treated as Year 1.
    expect(advanceCycle({ year: 0, summativeYear: false })).toEqual({
      year: 2,
      summativeYear: false,
    });
    // Above range (probationary) is treated as P3 and graduates.
    expect(advanceCycle({ year: 7, summativeYear: true })).toEqual({
      year: 1,
      summativeYear: false,
    });
  });

  it('always produces an in-range year and agrees with cycleStatus', () => {
    for (let year = 1; year <= 6; year++) {
      const next = advanceCycle({ year, summativeYear: year >= 4 });
      expect(next.year).toBeGreaterThanOrEqual(1);
      expect(next.year).toBeLessThanOrEqual(6);
      // A continuing summative result is exactly the Year-3 high-cycle slot.
      if (next.year < 4) {
        expect(cycleStatus(next.year, next.summativeYear)).toBe(next.year === 3 ? 'high' : 'low');
      } else {
        expect(cycleStatus(next.year, next.summativeYear)).toBe('probationary');
      }
    }
  });
});
