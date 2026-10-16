import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { OBSERVATION_STATUS, OBSERVATION_TYPES, type Observation } from '@ops/shared';
import { toRendererObservation } from './renderInputs.js';

function observation(over: Record<string, unknown> = {}): Observation & { id: string } {
  // Built the way the Admin SDK hands a doc over: dates are Timestamps even
  // though the type says Date.
  return {
    id: 'obs-1',
    status: OBSERVATION_STATUS.finalized,
    type: OBSERVATION_TYPES.standard,
    observerEmail: 'observer@orono.k12.mn.us',
    observedEmail: 'observed@orono.k12.mn.us',
    observedName: 'Observed Person',
    observedRole: 'teacher',
    observedYear: 1,
    observationDate: Timestamp.fromDate(new Date('2026-04-01T15:00:00Z')),
    ...over,
  } as unknown as Observation & { id: string };
}

describe('toRendererObservation', () => {
  it('turns a Firestore Timestamp observationDate into a Date', () => {
    const out = toRendererObservation(observation(), 'Teacher');
    expect(out.observationDate).toBeInstanceOf(Date);
    expect(out.observationDate.toISOString()).toBe('2026-04-01T15:00:00.000Z');
  });

  it('serializes the dates to ISO strings for the renderer POST', () => {
    const out = toRendererObservation(observation(), 'Teacher');
    const parsed = JSON.parse(JSON.stringify(out)) as { observationDate: unknown };
    expect(parsed.observationDate).toMatch(/^2026-04-01T/);
  });

  it('uses a passed finalizedAt over the stored one', () => {
    const finalizedAt = new Date('2026-05-02T12:00:00Z');
    const out = toRendererObservation(
      observation({ finalizedAt: Timestamp.fromDate(new Date('2026-04-02T12:00:00Z')) }),
      'Teacher',
      finalizedAt,
    );
    expect(out.finalizedAt).toBe(finalizedAt);
  });

  it('keeps the stored finalizedAt when none is passed', () => {
    const out = toRendererObservation(
      observation({ finalizedAt: Timestamp.fromDate(new Date('2026-04-02T12:00:00Z')) }),
      'Teacher',
    );
    expect(out.finalizedAt).toEqual(new Date('2026-04-02T12:00:00Z'));
  });

  it('swaps the role slug for its display name', () => {
    const out = toRendererObservation(observation(), 'Classroom Teacher');
    expect(out.observedRole).toBe('Classroom Teacher');
    expect(out.observationId).toBe('obs-1');
  });
});
