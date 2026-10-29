import { describe, expect, it } from 'vitest';
import { isCanonicalStaffEmail } from './constants.js';

describe('isCanonicalStaffEmail', () => {
  it('accepts a lowercase district address', () => {
    expect(isCanonicalStaffEmail('jane.doe@orono.k12.mn.us')).toBe(true);
  });

  it.each([
    ['mixed case', 'Jane.Doe@orono.k12.mn.us'],
    ['uppercase domain', 'jane.doe@ORONO.k12.mn.us'],
    ['surrounding whitespace', ' jane.doe@orono.k12.mn.us'],
    ['another domain', 'jane.doe@gmail.com'],
    ['look-alike domain', 'jane.doe@orono.k12.mn.us.evil.com'],
    ['subdomain', 'jane.doe@x.orono.k12.mn.us'],
    ['two @ signs', 'a@b@orono.k12.mn.us'],
    ['no local part', '@orono.k12.mn.us'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(isCanonicalStaffEmail(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isCanonicalStaffEmail(undefined)).toBe(false);
    expect(isCanonicalStaffEmail(42)).toBe(false);
  });
});
