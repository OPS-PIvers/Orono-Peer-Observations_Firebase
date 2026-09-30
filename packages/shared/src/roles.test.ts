import { describe, expect, it } from 'vitest';
import { OBSERVATION_TYPES } from './constants.js';
import {
  canOpenAdminConsole,
  creatableObservationTypes,
  isAdminRole,
  isSpecialRole,
  SPECIAL_ROLES,
} from './roles.js';

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

describe('canOpenAdminConsole', () => {
  it('opens for Full Access and for anyone with hasAdminAccess', () => {
    expect(canOpenAdminConsole(SPECIAL_ROLES.fullAccess, false)).toBe(true);
    expect(canOpenAdminConsole(SPECIAL_ROLES.administrator, true)).toBe(true);
    expect(canOpenAdminConsole('teacher', true)).toBe(true);
  });

  it('stays closed for a building Administrator without hasAdminAccess', () => {
    expect(canOpenAdminConsole(SPECIAL_ROLES.administrator, false)).toBe(false);
    expect(canOpenAdminConsole(SPECIAL_ROLES.administrator, undefined)).toBe(false);
    expect(canOpenAdminConsole(SPECIAL_ROLES.peerEvaluator, false)).toBe(false);
    expect(canOpenAdminConsole(null, null)).toBe(false);
  });
});

describe('creatableObservationTypes', () => {
  it('limits building Administrators to Standard', () => {
    expect(creatableObservationTypes(SPECIAL_ROLES.administrator)).toEqual([
      OBSERVATION_TYPES.standard,
    ]);
  });

  it('allows every type for peer evaluators and full access', () => {
    const all = Object.values(OBSERVATION_TYPES);
    expect(creatableObservationTypes(SPECIAL_ROLES.peerEvaluator)).toEqual(all);
    expect(creatableObservationTypes(SPECIAL_ROLES.fullAccess)).toEqual(all);
  });
});
