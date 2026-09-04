import { describe, expect, it } from 'vitest';
import {
  CYCLE_STATUSES,
  cycleStatus,
  cycleStatusLabel,
  displayYear,
  encodeYear,
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
  it('is high whenever summative, for any continuing year', () => {
    expect(cycleStatus(1, true)).toBe('high');
    expect(cycleStatus(2, true)).toBe('high');
    expect(cycleStatus(3, true)).toBe('high');
  });
  it('splits the non-summative continuing years into planning and developing', () => {
    expect(cycleStatus(1, false)).toBe('planning');
    expect(cycleStatus(2, false)).toBe('developing');
    expect(cycleStatus(3, false)).toBe('developing');
  });
});

describe('encodeYearStatus', () => {
  it('encodes high as the same year, summative true', () => {
    expect(encodeYearStatus(1, 'high')).toEqual({ year: 1, summativeYear: true });
    expect(encodeYearStatus(2, 'high')).toEqual({ year: 2, summativeYear: true });
  });
  it('pins planning to year 1 — the phase defines the year', () => {
    expect(encodeYearStatus(1, 'planning')).toEqual({ year: 1, summativeYear: false });
    expect(encodeYearStatus(3, 'planning')).toEqual({ year: 1, summativeYear: false });
  });
  it('keeps developing on years 2-3, promoting year 1 to year 2', () => {
    expect(encodeYearStatus(1, 'developing')).toEqual({ year: 2, summativeYear: false });
    expect(encodeYearStatus(2, 'developing')).toEqual({ year: 2, summativeYear: false });
    expect(encodeYearStatus(3, 'developing')).toEqual({ year: 3, summativeYear: false });
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
  it('exposes the four phases with human labels', () => {
    expect(CYCLE_STATUSES).toEqual(['planning', 'developing', 'high', 'probationary']);
    expect(cycleStatusLabel('planning')).toBe('Planning');
    expect(cycleStatusLabel('developing')).toBe('Developing');
    expect(cycleStatusLabel('high')).toBe('High Cycle');
    expect(cycleStatusLabel('probationary')).toBe('Probationary');
  });
});

describe('encodeYear', () => {
  it('moves the year without disturbing the summative flag', () => {
    expect(encodeYear(3, { year: 1, summativeYear: false })).toEqual({
      year: 3,
      summativeYear: false,
    });
    expect(encodeYear(1, { year: 3, summativeYear: true })).toEqual({
      year: 1,
      summativeYear: true,
    });
  });
  it('keeps probationary staff on the 4-6 encoding', () => {
    expect(encodeYear(2, { year: 4, summativeYear: true })).toEqual({
      year: 5,
      summativeYear: true,
    });
  });
});
