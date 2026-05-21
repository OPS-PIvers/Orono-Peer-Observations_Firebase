import { describe, expect, it } from 'vitest';
import {
  CYCLE_STATUSES,
  cycleStatus,
  cycleStatusLabel,
  displayYear,
  encodeYearStatus,
} from './staffCycle';

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

describe('encodeYearStatus', () => {
  it('encodes low/high as the same year with summative false/true', () => {
    expect(encodeYearStatus(2, 'low')).toEqual({ year: 2, summativeYear: false });
    expect(encodeYearStatus(2, 'high')).toEqual({ year: 2, summativeYear: true });
  });
  it('encodes probationary as year + 3, summative true', () => {
    expect(encodeYearStatus(1, 'probationary')).toEqual({ year: 4, summativeYear: true });
    expect(encodeYearStatus(3, 'probationary')).toEqual({ year: 6, summativeYear: true });
  });
  it('round-trips through display + cycleStatus', () => {
    for (let y = 1; y <= 6; y++) {
      for (const s of [true, false]) {
        const enc = encodeYearStatus(displayYear(y), cycleStatus(y, s));
        expect(displayYear(enc.year)).toBe(displayYear(y));
        expect(cycleStatus(enc.year, enc.summativeYear)).toBe(cycleStatus(y, s));
      }
    }
  });
});

describe('labels', () => {
  it('exposes the three statuses with human labels', () => {
    expect(CYCLE_STATUSES).toEqual(['low', 'high', 'probationary']);
    expect(cycleStatusLabel('low')).toBe('Low Cycle');
    expect(cycleStatusLabel('high')).toBe('High Cycle');
    expect(cycleStatusLabel('probationary')).toBe('Probationary');
  });
});
