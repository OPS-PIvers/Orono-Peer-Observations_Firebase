import { describe, expect, it } from 'vitest';
import { CYCLE_STATUSES, cycleStatus, displayYear } from './cycle.js';

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
