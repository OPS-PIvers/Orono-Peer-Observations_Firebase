import { describe, expect, it } from 'vitest';
import { OBSERVATION_STATUS, OBSERVATION_TYPES } from '@ops/shared';
import { directoryObservationChips } from './directoryObservationChips';

const NOW = new Date('2026-10-12T12:00:00Z');

function obs(
  observedEmail: string,
  type: (typeof OBSERVATION_TYPES)[keyof typeof OBSERVATION_TYPES],
  status: (typeof OBSERVATION_STATUS)[keyof typeof OBSERVATION_STATUS],
  observationDate = new Date('2026-09-20T12:00:00Z'),
) {
  return { observedEmail, type, status, observationDate };
}

describe('directoryObservationChips', () => {
  it('gives one chip per type, in OBS / WP / IR order', () => {
    const chips = directoryObservationChips(
      [
        obs('a@x.org', OBSERVATION_TYPES.instructionalRound, OBSERVATION_STATUS.finalized),
        obs('a@x.org', OBSERVATION_TYPES.standard, OBSERVATION_STATUS.draft),
        obs('a@x.org', OBSERVATION_TYPES.workProduct, OBSERVATION_STATUS.finalized),
      ],
      NOW,
    );
    expect(chips.get('a@x.org')).toEqual([
      { kind: 'OBS', state: 'inProgress' },
      { kind: 'WP', state: 'finalized' },
      { kind: 'IR', state: 'finalized' },
    ]);
  });

  it('shows in progress over finalized for the same type, in either order', () => {
    const draft = obs('a@x.org', OBSERVATION_TYPES.standard, OBSERVATION_STATUS.draft);
    const done = obs('a@x.org', OBSERVATION_TYPES.standard, OBSERVATION_STATUS.finalized);
    expect(directoryObservationChips([draft, done], NOW).get('a@x.org')).toEqual([
      { kind: 'OBS', state: 'inProgress' },
    ]);
    expect(directoryObservationChips([done, draft], NOW).get('a@x.org')).toEqual([
      { kind: 'OBS', state: 'inProgress' },
    ]);
  });

  it('drops finalized observations from earlier school years but keeps old drafts', () => {
    const lastYear = new Date('2026-05-01T12:00:00Z');
    const chips = directoryObservationChips(
      [
        obs('a@x.org', OBSERVATION_TYPES.standard, OBSERVATION_STATUS.finalized, lastYear),
        obs('b@x.org', OBSERVATION_TYPES.workProduct, OBSERVATION_STATUS.draft, lastYear),
      ],
      NOW,
    );
    expect(chips.has('a@x.org')).toBe(false);
    expect(chips.get('b@x.org')).toEqual([{ kind: 'WP', state: 'inProgress' }]);
  });

  it('keys on lowercased email and accepts ISO date strings', () => {
    const chips = directoryObservationChips(
      [
        {
          observedEmail: 'Mixed@X.org',
          type: OBSERVATION_TYPES.instructionalRound,
          status: OBSERVATION_STATUS.finalized,
          observationDate: '2026-08-15T12:00:00Z' as unknown as Date,
        },
      ],
      NOW,
    );
    expect(chips.get('mixed@x.org')).toEqual([{ kind: 'IR', state: 'finalized' }]);
  });
});
