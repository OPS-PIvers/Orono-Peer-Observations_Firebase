import { describe, expect, it } from 'vitest';
import {
  canEditObservationContent,
  canManageObservation,
  hasObservationOversight,
  observationAccessFor,
} from './observationAccess.js';

const obs = {
  observerEmail: 'pe@orono.k12.mn.us',
  observedEmail: 'teacher@orono.k12.mn.us',
  coObserverEmails: ['AP@orono.k12.mn.us'],
};

describe('observationAccessFor', () => {
  it('resolves each participant', () => {
    expect(observationAccessFor(obs, 'PE@orono.k12.mn.us', false)).toBe('owner');
    expect(observationAccessFor(obs, 'ap@orono.k12.mn.us', false)).toBe('coObserver');
    expect(observationAccessFor(obs, 'teacher@orono.k12.mn.us', false)).toBe('observed');
    expect(observationAccessFor(obs, 'principal@orono.k12.mn.us', false)).toBeNull();
    expect(observationAccessFor(obs, 'district@orono.k12.mn.us', true)).toBe('oversight');
  });

  it('makes the observed staff member just observed, even with oversight', () => {
    expect(observationAccessFor(obs, 'teacher@orono.k12.mn.us', true)).toBe('observed');
  });

  it('treats a missing co-observer list as empty', () => {
    const legacy = { observerEmail: obs.observerEmail, observedEmail: obs.observedEmail };
    expect(observationAccessFor(legacy, 'ap@orono.k12.mn.us', false)).toBeNull();
  });

  it('lets co-observers edit content but not manage', () => {
    expect(canEditObservationContent('coObserver')).toBe(true);
    expect(canManageObservation('coObserver')).toBe(false);
    expect(canManageObservation('owner')).toBe(true);
    expect(canEditObservationContent('observed')).toBe(false);
    expect(canEditObservationContent(null)).toBe(false);
  });
});

describe('hasObservationOversight', () => {
  it('is Full Access only, independent of Admin Console access', () => {
    expect(hasObservationOversight('full-access')).toBe(true);
    expect(hasObservationOversight('peer-evaluator')).toBe(false);
    expect(hasObservationOversight('administrator')).toBe(false);
    expect(hasObservationOversight(null)).toBe(false);
  });
});
