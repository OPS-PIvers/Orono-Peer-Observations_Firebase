import { describe, expect, it } from 'vitest';
import { computeClaims, elevatedAccessRevoked } from './computeClaims.js';

const NO_ACCESS = { role: null, hasSpecialAccess: false, isAdmin: false };

describe('computeClaims', () => {
  it('grants special access to an active Peer Evaluator', () => {
    expect(computeClaims({ role: 'peer-evaluator', isActive: true })).toEqual({
      role: 'peer-evaluator',
      hasSpecialAccess: true,
      isAdmin: false,
    });
  });

  it('grants admin to an active Administrator', () => {
    expect(computeClaims({ role: 'administrator', isActive: true })).toEqual({
      role: 'administrator',
      hasSpecialAccess: true,
      isAdmin: true,
    });
  });

  it('grants admin via the hasAdminAccess flag regardless of role', () => {
    expect(computeClaims({ role: 'teacher', hasAdminAccess: true, isActive: true })).toEqual({
      role: 'teacher',
      hasSpecialAccess: true,
      isAdmin: true,
    });
  });

  it('treats a legacy doc with no isActive field as active', () => {
    expect(computeClaims({ role: 'peer-evaluator' })).toEqual({
      role: 'peer-evaluator',
      hasSpecialAccess: true,
      isAdmin: false,
    });
  });

  it('collapses claims for an archived Peer Evaluator', () => {
    expect(computeClaims({ role: 'peer-evaluator', isActive: false })).toEqual(NO_ACCESS);
  });

  it('collapses claims for an archived Administrator', () => {
    expect(computeClaims({ role: 'administrator', isActive: false })).toEqual(NO_ACCESS);
  });

  it('collapses claims for an archived staff member with hasAdminAccess', () => {
    expect(computeClaims({ role: 'teacher', hasAdminAccess: true, isActive: false })).toEqual(
      NO_ACCESS,
    );
  });

  it('collapses claims when the staff doc is missing', () => {
    expect(computeClaims(null)).toEqual(NO_ACCESS);
    expect(computeClaims(undefined)).toEqual(NO_ACCESS);
  });

  it('issues plain-teacher claims for an active teacher', () => {
    expect(computeClaims({ role: 'teacher', isActive: true })).toEqual({
      role: 'teacher',
      hasSpecialAccess: false,
      isAdmin: false,
    });
  });
});

describe('elevatedAccessRevoked', () => {
  it('detects an archived Peer Evaluator', () => {
    const before = computeClaims({ role: 'peer-evaluator', isActive: true });
    const after = computeClaims({ role: 'peer-evaluator', isActive: false });
    expect(elevatedAccessRevoked(before, after)).toBe(true);
  });

  it('detects an admin demoted to teacher', () => {
    const before = computeClaims({ role: 'administrator', isActive: true });
    const after = computeClaims({ role: 'teacher', isActive: true });
    expect(elevatedAccessRevoked(before, after)).toBe(true);
  });

  it('detects a deleted special-access staff doc', () => {
    const before = computeClaims({ role: 'full-access', isActive: true });
    expect(elevatedAccessRevoked(before, computeClaims(undefined))).toBe(true);
  });

  it('does not fire on a promotion (teacher → Peer Evaluator)', () => {
    const before = computeClaims({ role: 'teacher', isActive: true });
    const after = computeClaims({ role: 'peer-evaluator', isActive: true });
    expect(elevatedAccessRevoked(before, after)).toBe(false);
  });

  it('does not fire when a plain teacher is archived', () => {
    const before = computeClaims({ role: 'teacher', isActive: true });
    const after = computeClaims({ role: 'teacher', isActive: false });
    expect(elevatedAccessRevoked(before, after)).toBe(false);
  });

  it('does not fire when elevated access is unchanged', () => {
    const pe = computeClaims({ role: 'peer-evaluator', isActive: true });
    expect(elevatedAccessRevoked(pe, pe)).toBe(false);
  });
});
