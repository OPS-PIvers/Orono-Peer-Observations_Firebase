import { describe, expect, it } from 'vitest';
import type { Observation } from '@ops/shared';
import {
  EVENT_EVALUATORS,
  resolveObservation,
  responseProgress,
  type ActiveQuestion,
  type DeriveContext,
} from './dashboardEvents';

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
    questions: [],
    appSettings: null,
    openBooking: null,
    hasBookedSlot: false,
    hasWorkProduct: true,
    hasInstructionalRound: true,
    ...partial,
  };
}

describe('resolveObservation', () => {
  it("'standard' prefers the live draft, falling back to finalized", () => {
    const f = obs({ observationId: 'fin' });
    const d = obs({ observationId: 'draft' });
    expect(
      resolveObservation(ctx({ finalizedStandard: [f], standardDraft: d }), 'standard')
        ?.observationId,
    ).toBe('draft');
    expect(resolveObservation(ctx({ finalizedStandard: [f] }), 'standard')?.observationId).toBe(
      'fin',
    );
    expect(resolveObservation(ctx({ standardDraft: d }), 'standard')?.observationId).toBe('draft');
  });

  it("'standardFinalized' ignores drafts entirely", () => {
    const f = obs({ observationId: 'fin', status: 'Finalized', finalizedAt: PAST });
    const d = obs({ observationId: 'draft' });
    expect(
      resolveObservation(ctx({ finalizedStandard: [f], standardDraft: d }), 'standardFinalized')
        ?.observationId,
    ).toBe('fin');
    expect(resolveObservation(ctx({ standardDraft: d }), 'standardFinalized')).toBeNull();
  });

  it('ignores the creation-default observationDate until genuinely scheduled', () => {
    const created = new Date('2026-03-01T10:00:00');
    // observationDate === createdAt is the CreateObservationDialog placeholder.
    const placeholder = obs({ createdAt: created, observationDate: new Date(created) });
    expect(EVENT_EVALUATORS.observationDateSet(ctx({}), placeholder, NOW).satisfied).toBe(false);
    expect(EVENT_EVALUATORS.observationDatePassed(ctx({}), placeholder, NOW).satisfied).toBe(false);
    // Evaluator-edited date (differs from createdAt) counts.
    const scheduled = obs({ createdAt: created, observationDate: new Date('2026-03-10T00:00:00') });
    expect(EVENT_EVALUATORS.observationDateSet(ctx({}), scheduled, NOW).satisfied).toBe(true);
    // A booked slot counts even if the instants happen to coincide.
    const booked = obs({
      createdAt: created,
      observationDate: new Date(created),
      scheduledStartAt: new Date(created),
    });
    expect(EVENT_EVALUATORS.observationDateSet(ctx({}), booked, NOW).satisfied).toBe(true);
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

  it('postQuestionsUnlocked opens the calendar day after the observation date', () => {
    // NOW is 2026-03-01T00:00Z; day-granularity comparison in local time.
    const sameDay = obs({ observationDate: NOW });
    const yesterday = obs({ observationDate: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) });
    expect(EVENT_EVALUATORS.postQuestionsUnlocked(ctx({}), sameDay, NOW).satisfied).toBe(false);
    const r = EVENT_EVALUATORS.postQuestionsUnlocked(ctx({}), yesterday, NOW);
    expect(r.satisfied).toBe(true);
    expect(r.date).toEqual(yesterday.observationDate);
    expect(EVENT_EVALUATORS.postQuestionsUnlocked(ctx({}), null, NOW).satisfied).toBe(false);
  });

  it('signupWindowOpened follows openBooking', () => {
    expect(EVENT_EVALUATORS.signupWindowOpened(ctx({}), null, NOW).satisfied).toBe(false);
    expect(
      EVENT_EVALUATORS.signupWindowOpened(
        ctx({ openBooking: { windowId: 'w', token: 't', endDate: null } }),
        null,
        NOW,
      ).satisfied,
    ).toBe(true);
  });
});

describe("resolveObservation('anyDraftFirst')", () => {
  it('prefers the live draft of any type over a finalized record', () => {
    const f = obs({ observationId: 'fin', status: 'Finalized', type: 'Standard' });
    const wp = obs({ observationId: 'wp', type: 'Work Product' });
    expect(
      resolveObservation(ctx({ finalizedStandard: [f], workProductDraft: wp }), 'anyDraftFirst')
        ?.observationId,
    ).toBe('wp');
    expect(
      resolveObservation(ctx({ finalizedStandard: [f] }), 'anyDraftFirst')?.observationId,
    ).toBe('fin');
    expect(resolveObservation(ctx({}), 'anyDraftFirst')).toBeNull();
  });
});

describe('responseProgress', () => {
  const bank: ActiveQuestion[] = [
    { questionId: 's-pre-1', type: 'standard', phase: 'pre' },
    { questionId: 's-pre-2', type: 'standard', phase: 'pre' },
    { questionId: 's-post-1', type: 'standard', phase: 'post' },
    { questionId: 'wp-1', type: 'work-product', phase: 'pre' },
    // Written before `phase` existed: counts as Planning.
    { questionId: 'wp-legacy', type: 'work-product' } as ActiveQuestion,
  ];
  const answers = (...ids: string[]) =>
    ids.map((questionId) => ({ questionId, answer: 'x', updatedAt: PAST }));

  it('scopes to the observation type and the requested panel', () => {
    const std = obs({ type: 'Standard', workProductAnswers: answers('s-pre-1', 's-post-1') });
    expect(responseProgress(ctx({ questions: bank }), std, 'planning')).toEqual({
      answered: 1,
      total: 2,
    });
    expect(responseProgress(ctx({ questions: bank }), std, 'reflection')).toEqual({
      answered: 1,
      total: 1,
    });
    expect(responseProgress(ctx({ questions: bank }), std, null)).toEqual({
      answered: 2,
      total: 3,
    });
  });

  it("never counts another type's questions or answers to deleted questions", () => {
    const wp = obs({
      type: 'Work Product',
      workProductAnswers: answers('wp-1', 'wp-legacy', 'deleted-q', 's-pre-1'),
    });
    expect(responseProgress(ctx({ questions: bank }), wp, 'planning')).toEqual({
      answered: 2,
      total: 2,
    });
  });

  it('ignores empty answers and a missing observation', () => {
    const std = obs({
      type: 'Standard',
      workProductAnswers: [{ questionId: 's-pre-1', answer: '', updatedAt: PAST }],
    });
    expect(responseProgress(ctx({ questions: bank }), std, 'planning').answered).toBe(0);
    expect(responseProgress(ctx({ questions: bank }), null, 'planning')).toEqual({
      answered: 0,
      total: 0,
    });
  });
});
