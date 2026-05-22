import { describe, expect, it } from 'vitest';
import { dashboardStep } from './dashboard.js';

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
