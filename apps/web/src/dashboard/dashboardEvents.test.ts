import { describe, expect, it } from 'vitest';
import type { Observation } from '@ops/shared';
import { EVENT_EVALUATORS, resolveObservation, type DeriveContext } from './dashboardEvents';

const NOW = new Date('2026-03-01T00:00:00Z');
const PAST = new Date('2026-02-01T00:00:00Z');
const FUTURE = new Date('2026-04-01T00:00:00Z');

function obs(partial: Partial<Observation>): Observation {
  return {
    observationId: 'obs-1',
    status: 'Draft',
    createdAt: PAST,
    lastModifiedAt: PAST,
    finalizedAt: null,
    acknowledgedAt: null,
    ...partial,
  } as unknown as Observation;
}

function ctx(partial: Partial<DeriveContext>): DeriveContext {
  return {
    finalizedStandard: [],
    standardDraft: null,
    workProductDraft: null,
    instructionalRoundDraft: null,
    finalizedWorkProduct: null,
    finalizedInstructionalRound: null,
    workProductQuestionsCount: 0,
    instructionalRoundQuestionsCount: 0,
    appSettings: null,
    openBooking: null,
    hasBookedSlot: false,
    hasWorkProduct: true,
    hasInstructionalRound: true,
    ...partial,
  };
}

describe('resolveObservation', () => {
  it('prefers finalized standard then draft', () => {
    const f = obs({ observationId: 'fin' });
    const d = obs({ observationId: 'draft' });
    expect(
      resolveObservation(ctx({ finalizedStandard: [f], standardDraft: d }), 'standard')
        ?.observationId,
    ).toBe('fin');
    expect(resolveObservation(ctx({ standardDraft: d }), 'standard')?.observationId).toBe('draft');
  });

  it("'anyDraft' prefers any active draft and ignores finalized observations", () => {
    const fin = obs({ observationId: 'fin', status: 'Finalized', finalizedAt: PAST });
    const draft = obs({ observationId: 'new-draft' });
    expect(resolveObservation(ctx({ finalizedStandard: [fin] }), 'anyDraft')).toBeNull();
    expect(
      resolveObservation(ctx({ finalizedStandard: [fin], workProductDraft: draft }), 'anyDraft')
        ?.observationId,
    ).toBe('new-draft');
  });
});

describe('EVENT_EVALUATORS', () => {
  it('observationCreated is satisfied when an observation exists', () => {
    expect(EVENT_EVALUATORS.observationCreated(ctx({}), null, NOW).satisfied).toBe(false);
    expect(EVENT_EVALUATORS.observationCreated(ctx({}), obs({}), NOW).satisfied).toBe(true);
  });

  it('preObsDateSet vs preObsDatePassed', () => {
    const future = obs({ preObsDate: FUTURE });
    const past = obs({ preObsDate: PAST });
    expect(EVENT_EVALUATORS.preObsDateSet(ctx({}), future, NOW).satisfied).toBe(true);
    expect(EVENT_EVALUATORS.preObsDatePassed(ctx({}), future, NOW).satisfied).toBe(false);
    expect(EVENT_EVALUATORS.preObsDatePassed(ctx({}), past, NOW).satisfied).toBe(true);
  });

  it('finalized reads status + finalizedAt date', () => {
    const r = EVENT_EVALUATORS.finalized(
      ctx({}),
      obs({ status: 'Finalized', finalizedAt: PAST }),
      NOW,
    );
    expect(r.satisfied).toBe(true);
    expect(r.date).toEqual(PAST);
  });

  it('signupWindowOpened follows openBooking', () => {
    expect(EVENT_EVALUATORS.signupWindowOpened(ctx({}), null, NOW).satisfied).toBe(false);
    expect(
      EVENT_EVALUATORS.signupWindowOpened(
        ctx({ openBooking: { windowId: 'w', token: 't' } }),
        null,
        NOW,
      ).satisfied,
    ).toBe(true);
  });
});
