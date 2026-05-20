import { describe, expect, it } from 'vitest';
import { applyDayCountChange, dayHasCapacity, meetsLeadTime } from './bookingRules.js';

const HOUR = 60 * 60 * 1000;

describe('meetsLeadTime', () => {
  const now = Date.UTC(2025, 2, 10, 8, 0, 0);

  it('allows a slot far in the future', () => {
    expect(meetsLeadTime(now + 48 * HOUR, now, 24)).toBe(true);
  });

  it('blocks a slot inside the lead window', () => {
    expect(meetsLeadTime(now + 12 * HOUR, now, 24)).toBe(false);
  });

  it('treats the exact boundary as allowed', () => {
    expect(meetsLeadTime(now + 24 * HOUR, now, 24)).toBe(true);
  });

  it('zero lead time allows booking up to slot start', () => {
    expect(meetsLeadTime(now, now, 0)).toBe(true);
    expect(meetsLeadTime(now - 1, now, 0)).toBe(false);
  });
});

describe('dayHasCapacity', () => {
  it('null cap is always uncapped', () => {
    expect(dayHasCapacity(999, null)).toBe(true);
  });

  it('respects a numeric cap', () => {
    expect(dayHasCapacity(1, 2)).toBe(true);
    expect(dayHasCapacity(2, 2)).toBe(false);
    expect(dayHasCapacity(3, 2)).toBe(false);
  });
});

describe('applyDayCountChange', () => {
  it('increments a brand-new preference', () => {
    expect(applyDayCountChange({}, '2025-03-10', null)).toEqual({ '2025-03-10': 1 });
  });

  it('moves a preference between days', () => {
    expect(
      applyDayCountChange({ '2025-03-10': 2, '2025-03-11': 1 }, '2025-03-11', '2025-03-10'),
    ).toEqual({ '2025-03-10': 1, '2025-03-11': 2 });
  });

  it('is a no-op when the day is unchanged', () => {
    expect(applyDayCountChange({ '2025-03-10': 3 }, '2025-03-10', '2025-03-10')).toEqual({
      '2025-03-10': 3,
    });
  });

  it('never drives a count below zero', () => {
    expect(applyDayCountChange({ '2025-03-10': 0 }, '2025-03-11', '2025-03-10')).toEqual({
      '2025-03-10': 0,
      '2025-03-11': 1,
    });
  });

  it('does not mutate the input', () => {
    const input = { '2025-03-10': 1 };
    applyDayCountChange(input, '2025-03-11', '2025-03-10');
    expect(input).toEqual({ '2025-03-10': 1 });
  });
});
