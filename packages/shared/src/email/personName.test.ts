import { describe, expect, it } from 'vitest';
import { firstNameOf, formatPersonName } from './personName.js';

describe('formatPersonName', () => {
  it.each([
    ['IVERS, PAUL', 'Paul Ivers'],
    ['Ivers, Paul', 'Paul Ivers'],
    ['paul.ivers', 'Paul Ivers'],
    ['paul.ivers@orono.k12.mn.us', 'Paul Ivers'],
    ['Jane McDonald', 'Jane McDonald'],
    ["O'BRIEN, MARY-KATE", "Mary-Kate O'Brien"],
    ['  Sam  ', 'Sam'],
    ['', ''],
  ])('%s → %s', (raw, expected) => {
    expect(formatPersonName(raw)).toBe(expected);
  });
});

describe('firstNameOf', () => {
  it('returns the given name from roster and email shapes', () => {
    expect(firstNameOf('IVERS, PAUL')).toBe('Paul');
    expect(firstNameOf('paul.ivers')).toBe('Paul');
    expect(firstNameOf('Sarah Johnson')).toBe('Sarah');
    expect(firstNameOf('')).toBe('');
  });
});
