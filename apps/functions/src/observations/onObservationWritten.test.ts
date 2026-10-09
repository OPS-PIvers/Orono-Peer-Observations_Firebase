import { describe, expect, it } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { coObserverChanges, isNewlyAcknowledged } = await import('./onObservationWritten.js');

describe('isNewlyAcknowledged', () => {
  it('fires only when acknowledgedAt goes from unset to set', () => {
    const at = new Date();
    expect(isNewlyAcknowledged({ acknowledgedAt: null }, { acknowledgedAt: at })).toBe(true);
    expect(isNewlyAcknowledged({}, { acknowledgedAt: at })).toBe(true);
    expect(isNewlyAcknowledged({ acknowledgedAt: at }, { acknowledgedAt: at })).toBe(false);
    expect(isNewlyAcknowledged({ acknowledgedAt: null }, { acknowledgedAt: null })).toBe(false);
    // Reopen clears it; that's not an acknowledgment.
    expect(isNewlyAcknowledged({ acknowledgedAt: at }, { acknowledgedAt: null })).toBe(false);
  });
});

describe('coObserverChanges', () => {
  const base = { observerEmail: 'owner@x.org', observedEmail: 'teacher@x.org' };

  it('reports added and removed co-observers, case-insensitively', () => {
    expect(
      coObserverChanges(
        { ...base, coObserverEmails: ['A@x.org', 'b@x.org'] },
        { ...base, coObserverEmails: ['a@x.org', 'c@x.org'] },
      ),
    ).toEqual({ added: ['c@x.org'], removed: ['b@x.org'] });
  });

  it('treats a missing list as empty', () => {
    expect(coObserverChanges(base, { ...base, coObserverEmails: ['a@x.org'] })).toEqual({
      added: ['a@x.org'],
      removed: [],
    });
    expect(coObserverChanges(base, base)).toEqual({ added: [], removed: [] });
  });

  it('never reports the observer or observed staff as removed', () => {
    expect(
      coObserverChanges(
        { ...base, coObserverEmails: ['Owner@x.org', 'teacher@x.org'] },
        { ...base, coObserverEmails: [] },
      ),
    ).toEqual({ added: [], removed: [] });
  });
});
