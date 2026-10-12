import { describe, expect, it } from 'vitest';
import { dayKeysBack, formatTokens, formatUsd, rangeStartKey } from './aiUsage';

describe('formatUsd', () => {
  it('keeps fractions of a cent visible', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0.528)).toBe('$0.528');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });
});

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(8_700)).toBe('8.7K');
    expect(formatTokens(86_400)).toBe('86K');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });
});

describe('date ranges', () => {
  const now = new Date('2026-10-12T18:00:00Z');

  it('lists district-local days oldest first, ending today', () => {
    const keys = dayKeysBack(3, now);
    expect(keys).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
  });

  it('starts each range on the right day', () => {
    expect(rangeStartKey('today', now)).toBe('2026-10-12');
    expect(rangeStartKey('month', now)).toBe('2026-10-01');
    expect(rangeStartKey('7d', now)).toBe('2026-10-06');
    expect(rangeStartKey('30d', now)).toBe('2026-09-13');
  });
});
