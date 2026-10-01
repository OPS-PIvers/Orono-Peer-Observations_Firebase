import { describe, expect, it } from 'vitest';
import { canObserve, observeBlockReason } from './observability.js';

const admin = { role: 'administrator', buildings: ['Orono High School'] };
const teacher = {
  isActive: true,
  buildings: ['Orono High School'],
  year: 2,
  cycleStatus: 'high' as const,
};

describe('observeBlockReason', () => {
  it('lets an administrator observe summative staff in their building', () => {
    expect(observeBlockReason(admin, teacher)).toBeNull();
    expect(canObserve(admin, { ...teacher, cycleStatus: 'probationary' })).toBe(true);
  });

  it('blocks staff outside the administrator’s buildings', () => {
    expect(observeBlockReason(admin, { ...teacher, buildings: ['Schumann Elementary'] })).toBe(
      'Not in your building',
    );
  });

  it('blocks non-summative staff', () => {
    expect(observeBlockReason(admin, { ...teacher, cycleStatus: 'developing' })).toMatch(
      /Probationary and High Cycle/,
    );
    expect(canObserve(admin, { ...teacher, cycleStatus: 'planning' })).toBe(false);
  });

  it('blocks archived staff', () => {
    expect(canObserve(admin, { ...teacher, isActive: false })).toBe(false);
  });

  it('falls back to the legacy status when none is stored', () => {
    expect(canObserve(admin, { ...teacher, cycleStatus: null, year: 4 })).toBe(true);
    expect(canObserve(admin, { ...teacher, cycleStatus: null, year: 2 })).toBe(false);
  });

  it('leaves Peer Evaluators and Full Access unrestricted', () => {
    const outside = {
      ...teacher,
      buildings: ['Schumann Elementary'],
      cycleStatus: 'developing' as const,
    };
    expect(canObserve({ role: 'peer-evaluator', buildings: [] }, outside)).toBe(true);
    expect(canObserve({ role: 'full-access', buildings: [] }, outside)).toBe(true);
  });
});
