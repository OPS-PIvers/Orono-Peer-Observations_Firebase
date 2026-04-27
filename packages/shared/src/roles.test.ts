import { describe, expect, it } from 'vitest';
import { isAdminRole, isSpecialRole, SPECIAL_ROLES } from './roles.js';

describe('isSpecialRole', () => {
  it('matches all special-access roles', () => {
    expect(isSpecialRole(SPECIAL_ROLES.administrator)).toBe(true);
    expect(isSpecialRole(SPECIAL_ROLES.peerEvaluator)).toBe(true);
    expect(isSpecialRole(SPECIAL_ROLES.fullAccess)).toBe(true);
  });

  it('rejects regular staff roles and nullish input', () => {
    expect(isSpecialRole('Teacher')).toBe(false);
    expect(isSpecialRole('Nurse')).toBe(false);
    expect(isSpecialRole(null)).toBe(false);
    expect(isSpecialRole(undefined)).toBe(false);
  });
});

describe('isAdminRole', () => {
  it('only matches Administrator and Full Access', () => {
    expect(isAdminRole(SPECIAL_ROLES.administrator)).toBe(true);
    expect(isAdminRole(SPECIAL_ROLES.fullAccess)).toBe(true);
    expect(isAdminRole(SPECIAL_ROLES.peerEvaluator)).toBe(false);
    expect(isAdminRole('Teacher')).toBe(false);
  });
});
