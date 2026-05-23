import { describe, expect, it } from 'vitest';
import { dashboardStep, DEFAULT_STEPS, applyLegacyOverride, resolveSteps } from './dashboard.js';

describe('dashboardStep', () => {
  it('applies defaults for a minimal step', () => {
    const s = dashboardStep.parse({ id: 'x' });
    expect(s.enabled).toBe(true);
    expect(s.order).toBe(0);
    expect(s.watchedKind).toBe('standard');
    expect(s.chipStyle).toBe('meeting');
    expect(s.showWhen).toBe('always');
    expect(s.doneWhen).toBe('never');
    expect(s.dateFrom).toBe('none');
    expect(s.inProgress).toBe('none');
    expect(s.hideWhenDone).toBe(false);
    expect(s.buttonTarget).toBe('observation');
  });

  it('rejects an unknown showWhen event', () => {
    expect(() => dashboardStep.parse({ id: 'x', showWhen: 'not-an-event' })).toThrow();
  });

  it('requires a non-empty id', () => {
    expect(() => dashboardStep.parse({})).toThrow();
  });
});

describe('DEFAULT_STEPS', () => {
  it('has the 8 built-in ids in cycle order', () => {
    expect(DEFAULT_STEPS.map((s) => s.id)).toEqual([
      'signup',
      'preObs',
      'workProduct',
      'observation',
      'reviewDraft',
      'postObs',
      'acknowledge',
      'instructionalRound',
    ]);
  });

  it('marks meetings/visit done when their date passes', () => {
    const byId = Object.fromEntries(DEFAULT_STEPS.map((s) => [s.id, s]));
    expect(byId['preObs']?.doneWhen).toBe('preObsDatePassed');
    expect(byId['observation']?.doneWhen).toBe('observationDatePassed');
    expect(byId['postObs']?.doneWhen).toBe('postObsDatePassed');
    expect(byId['acknowledge']?.doneWhen).toBe('acknowledged');
    expect(byId['reviewDraft']?.watchedKind).toBe('anyDraft');
  });
});

describe('resolveSteps', () => {
  it('seeds DEFAULT_STEPS when config has no steps', () => {
    expect(resolveSteps(null).map((s) => s.id)).toEqual(DEFAULT_STEPS.map((s) => s.id));
  });

  it('returns saved steps verbatim when present', () => {
    const custom = [dashboardStep.parse({ id: 'only-one' })];
    expect(resolveSteps({ steps: custom } as never)).toEqual(custom);
  });

  it('carries legacy enable/order/label overrides onto the matching seed', () => {
    const steps = resolveSteps({
      checkpoints: { signup: { enabled: false, order: 5, titleOverride: 'Pick a slot' } },
    } as never);
    const signup = steps.find((s) => s.id === 'signup');
    expect(signup?.enabled).toBe(false);
    expect(signup?.order).toBe(5);
    expect(signup?.title).toBe('Pick a slot');
  });
});

describe('applyLegacyOverride', () => {
  it('returns the seed unchanged when no legacy entry', () => {
    const seed = dashboardStep.parse({ id: 'signup', title: 'Default' });
    expect(applyLegacyOverride(seed, undefined)).toEqual(seed);
  });
});
