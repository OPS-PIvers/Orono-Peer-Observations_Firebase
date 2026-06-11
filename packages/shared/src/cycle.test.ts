import { describe, expect, it } from 'vitest';
import { CYCLE_STATUSES, cycleStatus, displayYear, schoolYearStart } from './cycle.js';

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
