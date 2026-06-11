import { describe, expect, it } from 'vitest';
import {
  applyLegacyOverride,
  cycleCloseMonthDay,
  dashboardConfig,
  dashboardStep,
  DEFAULT_CYCLE_CLOSE_MONTH_DAY,
  DEFAULT_STEPS,
  resolveSteps,
} from './dashboard.js';

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

  it('treats an explicitly emptied steps array as authoritative', () => {
    expect(resolveSteps({ steps: [] } as never)).toEqual([]);
  });

  it('falls back to defaults only when the steps field is missing entirely', () => {
    expect(resolveSteps({} as never).map((s) => s.id)).toEqual(DEFAULT_STEPS.map((s) => s.id));
    expect(resolveSteps(undefined).map((s) => s.id)).toEqual(DEFAULT_STEPS.map((s) => s.id));
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

describe('cycleCloseMonthDay', () => {
  it('accepts valid MM-DD strings', () => {
    expect(cycleCloseMonthDay.parse('05-15')).toBe('05-15');
    expect(cycleCloseMonthDay.parse('06-01')).toBe('06-01');
    expect(cycleCloseMonthDay.parse('12-31')).toBe('12-31');
    expect(cycleCloseMonthDay.parse('01-01')).toBe('01-01');
  });

  it('rejects invalid formats', () => {
    expect(() => cycleCloseMonthDay.parse('5-15')).toThrow();
    expect(() => cycleCloseMonthDay.parse('13-01')).toThrow();
    expect(() => cycleCloseMonthDay.parse('00-15')).toThrow();
    expect(() => cycleCloseMonthDay.parse('05-32')).toThrow();
    expect(() => cycleCloseMonthDay.parse('May 15')).toThrow();
    expect(() => cycleCloseMonthDay.parse('2025-05-15')).toThrow();
    expect(() => cycleCloseMonthDay.parse('')).toThrow();
  });

  it('DEFAULT_CYCLE_CLOSE_MONTH_DAY is a valid MM-DD', () => {
    expect(cycleCloseMonthDay.parse(DEFAULT_CYCLE_CLOSE_MONTH_DAY)).toBe('05-15');
  });
});

describe('dashboardConfig cycleCloseDate', () => {
  it('is absent on a minimal parse (undefined by default)', () => {
    const config = dashboardConfig.parse({ updatedAt: new Date() });
    expect(config.cycleCloseDate).toBeUndefined();
  });

  it('round-trips a valid MM-DD value', () => {
    const config = dashboardConfig.parse({ updatedAt: new Date(), cycleCloseDate: '06-01' });
    expect(config.cycleCloseDate).toBe('06-01');
  });

  it('rejects an invalid MM-DD in the config', () => {
    expect(() =>
      dashboardConfig.parse({ updatedAt: new Date(), cycleCloseDate: 'not-a-date' }),
    ).toThrow();
  });
});
