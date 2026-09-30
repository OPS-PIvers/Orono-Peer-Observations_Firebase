import { describe, expect, it } from 'vitest';
import type { Staff } from '@ops/shared';
import { assertCanObserveAll, blockedStaff } from './observeScope.js';

const staff = (over: Partial<Staff>): Staff =>
  ({
    email: 'jane@orono.k12.mn.us',
    name: 'Jane Doe',
    role: 'teacher',
    year: 2,
    cycleStatus: 'high',
    summativeYear: true,
    buildings: ['OMS'],
    isActive: true,
    ...over,
  }) as Staff;

const admin = { role: 'administrator', buildings: ['OMS'] };

describe('blockedStaff', () => {
  it('names each person an administrator cannot observe, with the reason', () => {
    expect(
      blockedStaff(admin, [
        staff({}),
        staff({ name: 'Dev', cycleStatus: 'developing' }),
        staff({ name: 'Far', buildings: ['OHS'] }),
      ]),
    ).toEqual([
      'Dev (Only Probationary and High Cycle staff can be observed)',
      'Far (Not in your building)',
    ]);
  });

  it('treats a doc without isActive as active', () => {
    expect(blockedStaff(admin, [staff({ isActive: undefined as unknown as boolean })])).toEqual([]);
  });

  it('blocks no one for a Peer Evaluator', () => {
    expect(
      blockedStaff({ role: 'peer-evaluator', buildings: [] }, [staff({ cycleStatus: 'planning' })]),
    ).toEqual([]);
  });
});

describe('assertCanObserveAll', () => {
  it('throws failed-precondition listing the blocked staff', () => {
    expect(() => assertCanObserveAll(admin, [staff({ name: 'Far', buildings: ['OHS'] })])).toThrow(
      /Far \(Not in your building\)/,
    );
  });

  it('passes when everyone is observable', () => {
    expect(() =>
      assertCanObserveAll(admin, [staff({ cycleStatus: 'probationary' })]),
    ).not.toThrow();
  });
});
