import { describe, expect, it } from 'vitest';
import {
  dashboardStep,
  DEFAULT_STEPS,
  applyLegacyOverride,
  resolveSteps,
  stepAllowsEvaluatorCheck,
  stepCheckScope,
  stepCompletionMode,
  type DashboardStep,
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
  it('has the 6 built-in ids in cycle order', () => {
    expect(DEFAULT_STEPS.map((s) => s.id)).toEqual([
      'signup',
      'preObs',
      'observation',
      'reviewDraft',
      'postObs',
      'acknowledge',
    ]);
  });

  it('Planning and Reflection deep-link into their panels and track every observation type', () => {
    const byId = Object.fromEntries(DEFAULT_STEPS.map((s) => [s.id, s]));
    expect(byId['preObs']?.openPanel).toBe('planning');
    expect(byId['postObs']?.openPanel).toBe('reflection');
    expect(byId['preObs']?.watchedKind).toBe('anyDraftFirst');
    expect(byId['postObs']?.watchedKind).toBe('anyDraftFirst');
    expect(byId['preObs']?.inProgress).toBe('responseProgress');
    expect(byId['postObs']?.showWhen).toBe('postQuestionsUnlocked');
    // No separate Work Product / Instructional Round cards: every type has
    // questions, and they live on the Planning / Reflection cards.
    expect(byId['workProduct']).toBeUndefined();
    expect(byId['instructionalRound']).toBeUndefined();
  });

  it('parses a step saved before openPanel existed as openPanel: null', () => {
    expect(dashboardStep.parse({ id: 'legacy' }).openPanel).toBeNull();
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

describe('step completion mode', () => {
  it('defaults to auto, so steps saved before the field existed keep completing automatically', () => {
    expect(dashboardStep.parse({ id: 'legacy' }).completionMode).toBe('auto');
    expect(DEFAULT_STEPS.every((s) => s.completionMode === 'auto')).toBe(true);
  });

  it('reads a raw Firestore step with no completionMode as auto', () => {
    const raw = { id: 'raw' } as unknown as DashboardStep;
    expect(stepCompletionMode(raw)).toBe('auto');
    expect(stepAllowsEvaluatorCheck(raw)).toBe(false);
  });

  it('round-trips manual and either through JSON (the saved config doc)', () => {
    for (const mode of ['manual', 'either'] as const) {
      const step = dashboardStep.parse({ id: 's', completionMode: mode });
      const reparsed = dashboardStep.parse(JSON.parse(JSON.stringify(step)));
      expect(reparsed.completionMode).toBe(mode);
      expect(stepAllowsEvaluatorCheck(reparsed)).toBe(true);
    }
  });

  it('rejects an unknown mode', () => {
    expect(() => dashboardStep.parse({ id: 's', completionMode: 'sometimes' })).toThrow();
  });
});

describe('stepCheckScope', () => {
  it('stores the sign-up step on the staff member and every other built-in on the observation', () => {
    const scopes = Object.fromEntries(DEFAULT_STEPS.map((s) => [s.id, stepCheckScope(s)]));
    expect(scopes).toEqual({
      signup: 'staff',
      preObs: 'observation',
      observation: 'observation',
      reviewDraft: 'observation',
      postObs: 'observation',
      acknowledge: 'observation',
    });
  });

  it('treats a step that reads nothing from the observation as staff-scoped', () => {
    const step = dashboardStep.parse({
      id: 'custom',
      showWhen: 'always',
      doneWhen: 'never',
      buttonTarget: 'fixedUrl',
    });
    expect(stepCheckScope(step)).toBe('staff');
  });

  it('ties a step to the observation when any one slot reads it', () => {
    const base = { id: 'c', showWhen: 'always', doneWhen: 'never', buttonTarget: 'none' } as const;
    const scopeOf = (patch: Record<string, string>) =>
      stepCheckScope(dashboardStep.parse({ ...base, ...patch }));
    expect(scopeOf({ doneWhen: 'finalized' })).toBe('observation');
    expect(scopeOf({ showWhen: 'observationCreated' })).toBe('observation');
    expect(scopeOf({ dateFrom: 'postObsDate' })).toBe('observation');
    expect(scopeOf({ inProgress: 'responseProgress' })).toBe('observation');
    expect(scopeOf({ buttonTarget: 'acknowledge' })).toBe('observation');
    expect(scopeOf({ dateFrom: 'windowEndDate', buttonTarget: 'booking' })).toBe('staff');
  });
});
