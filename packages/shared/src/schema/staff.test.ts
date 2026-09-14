import { describe, expect, it } from 'vitest';
import { rolloverEntryCycleStatus, staff, staffRolloverEntry } from './staff.js';

const email = 'jane.doe@orono.k12.mn.us';

describe('staff schema — cycleStatus', () => {
  const base = {
    email,
    name: 'Jane Doe',
    role: 'teacher',
    year: 5,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('keeps a doc without cycleStatus parseable and does not default one in', () => {
    const parsed = staff.parse(base);
    expect(parsed.cycleStatus).toBeUndefined();
  });

  it('accepts any status on any year — the two are independent', () => {
    expect(staff.parse({ ...base, year: 5, cycleStatus: 'developing' }).cycleStatus).toBe(
      'developing',
    );
    expect(staff.parse({ ...base, year: 1, cycleStatus: 'probationary' }).cycleStatus).toBe(
      'probationary',
    );
  });

  it('rejects an unknown or retired status', () => {
    expect(() => staff.parse({ ...base, cycleStatus: 'low' })).toThrow();
  });
});

describe('staffRolloverEntry', () => {
  it('accepts toCycleStatus', () => {
    const entry = staffRolloverEntry.parse({
      email,
      fromYear: 2,
      toYear: 3,
      toCycleStatus: 'high',
    });
    expect(rolloverEntryCycleStatus(entry)).toBe('high');
  });

  it('prefers toCycleStatus over a contradictory toSummativeYear', () => {
    const entry = staffRolloverEntry.parse({
      email,
      fromYear: 5,
      toYear: 6,
      toCycleStatus: 'developing',
      toSummativeYear: true,
    });
    expect(rolloverEntryCycleStatus(entry)).toBe('developing');
  });

  it('still accepts a pre-status entry and derives its status the legacy way', () => {
    const entry = staffRolloverEntry.parse({
      email,
      fromYear: 2,
      toYear: 3,
      toSummativeYear: true,
    });
    expect(rolloverEntryCycleStatus(entry)).toBe('high');
    expect(
      rolloverEntryCycleStatus(
        staffRolloverEntry.parse({ email, fromYear: 3, toYear: 1, toSummativeYear: false }),
      ),
    ).toBe('planning');
  });

  it('requires one of toCycleStatus / toSummativeYear', () => {
    expect(() => staffRolloverEntry.parse({ email, fromYear: 1, toYear: 2 })).toThrow();
  });
});
