import { describe, expect, it } from 'vitest';
import { DEFAULT_STEPS, dashboardStep, type Observation } from '@ops/shared';
import { deriveCheckpoints } from './deriveCheckpoints';
import type { DeriveContext } from './dashboardEvents';

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

describe('deriveCheckpoints (seed behavior)', () => {
  it('hides everything for a staff member with no observation and no window', () => {
    expect(deriveCheckpoints(DEFAULT_STEPS, ctx({}), NOW)).toEqual([]);
  });

  it('shows signup as soon when a window is open', () => {
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ openBooking: { windowId: 'w', token: 't' } }),
      NOW,
    );
    const signup = cards.find((c) => c.id === 'signup');
    expect(signup?.status).toBe('soon');
    expect(signup?.ctaUrl).toBe('/book/w?token=t');
  });

  it('marks the pre-obs meeting done once its date is in the past', () => {
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ standardDraft: obs({ preObsDate: PAST, observationDate: FUTURE }) }),
      NOW,
    );
    expect(cards.find((c) => c.id === 'preObs')?.status).toBe('done');
    expect(cards.find((c) => c.id === 'observation')?.status).toBe('soon');
  });

  it('reviewDraft vanishes once finalized (no active draft)', () => {
    const finalized = obs({ status: 'Finalized', finalizedAt: PAST });
    const cards = deriveCheckpoints(DEFAULT_STEPS, ctx({ finalizedStandard: [finalized] }), NOW);
    expect(cards.find((c) => c.id === 'reviewDraft')).toBeUndefined();
  });

  it('reviewDraft re-shows for a fresh draft even when a prior cycle is finalized', () => {
    // Overlapping cycles: an old finalized standard obs + a new active draft.
    // anyDraft must surface the draft so the card reappears.
    const oldFinalized = obs({ observationId: 'old', status: 'Finalized', finalizedAt: PAST });
    const newDraft = obs({ observationId: 'new', lastModifiedAt: PAST });
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ finalizedStandard: [oldFinalized], standardDraft: newDraft }),
      NOW,
    );
    const review = cards.find((c) => c.id === 'reviewDraft');
    expect(review).toBeDefined();
    expect(review?.status).toBe('soon');
  });

  it('drives the work-product progress bar from answers', () => {
    const wp = obs({
      observationId: 'wp',
      workProductAnswers: [
        { answer: 'a' },
        { answer: '' },
        { answer: 'b' },
      ] as unknown as Observation['workProductAnswers'],
    });
    const cards = deriveCheckpoints(
      DEFAULT_STEPS,
      ctx({ workProductDraft: wp, workProductQuestionsCount: 4 }),
      NOW,
    );
    const card = cards.find((c) => c.id === 'workProduct');
    expect(card?.status).toBe('inprogress');
    expect(card?.percent).toBe(50);
    expect(card?.percentLabel).toBe('2 of 4 answered');
  });
});

describe('deriveCheckpoints (generic slots)', () => {
  it('a done + hideWhenDone step still gates the next previousStepDone step', () => {
    // A hidden-but-done step's done state propagates to the next chained step.
    // (Without this, a hide-when-done step would silently break chains.)
    const a = dashboardStep.parse({
      id: 'a',
      order: 0,
      showWhen: 'always',
      doneWhen: 'finalized',
      hideWhenDone: true,
    });
    const b = dashboardStep.parse({
      id: 'b',
      order: 1,
      showWhen: 'previousStepDone',
      doneWhen: 'never',
    });
    const finCtx = ctx({ finalizedStandard: [obs({ status: 'Finalized', finalizedAt: PAST })] });
    expect(deriveCheckpoints([a, b], finCtx, NOW).map((c) => c.id)).toEqual(['b']);
  });

  it('previousStepDone gates a step until the prior one is done', () => {
    const a = dashboardStep.parse({ id: 'a', order: 0, showWhen: 'always', doneWhen: 'finalized' });
    const b = dashboardStep.parse({
      id: 'b',
      order: 1,
      showWhen: 'previousStepDone',
      doneWhen: 'never',
    });
    expect(
      deriveCheckpoints([a, b], ctx({ standardDraft: obs({}) }), NOW).map((c) => c.id),
    ).toEqual(['a']);
    const fin = ctx({ finalizedStandard: [obs({ status: 'Finalized', finalizedAt: PAST })] });
    expect(deriveCheckpoints([a, b], fin, NOW).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('respects enabled + order', () => {
    const a = dashboardStep.parse({ id: 'a', order: 2, showWhen: 'always' });
    const b = dashboardStep.parse({ id: 'b', order: 1, showWhen: 'always' });
    const c = dashboardStep.parse({ id: 'c', order: 0, showWhen: 'always', enabled: false });
    expect(deriveCheckpoints([a, b, c], ctx({}), NOW).map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('falls back to "Awaiting date" when shown with no concrete date', () => {
    // pre-obs is shown (observation created) but has no pre-obs date yet
    const cards = deriveCheckpoints(DEFAULT_STEPS, ctx({ standardDraft: obs({}) }), NOW);
    expect(cards.find((c) => c.id === 'preObs')?.dateLabel).toBe('Awaiting date');
  });

  it('fixedUrl button uses buttonUrl; none renders inert', () => {
    const link = dashboardStep.parse({
      id: 'l',
      showWhen: 'always',
      buttonTarget: 'fixedUrl',
      buttonUrl: '/x',
    });
    const inert = dashboardStep.parse({ id: 'i', showWhen: 'always', buttonTarget: 'none' });
    const cards = deriveCheckpoints([link, inert], ctx({}), NOW);
    expect(cards.find((c) => c.id === 'l')?.ctaUrl).toBe('/x');
    expect(cards.find((c) => c.id === 'i')?.ctaUrl).toBe('');
  });
});
