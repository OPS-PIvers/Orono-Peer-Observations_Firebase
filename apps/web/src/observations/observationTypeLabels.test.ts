import { describe, expect, it } from 'vitest';
import { OBSERVATION_TYPES } from '@ops/shared';
import { planningPanelLabel } from './observationTypeLabels';

describe('planningPanelLabel', () => {
  it('calls the pre-observation panel Observation Notes for Instructional Rounds only', () => {
    expect(planningPanelLabel(OBSERVATION_TYPES.instructionalRound)).toBe('Observation Notes');
    expect(planningPanelLabel(OBSERVATION_TYPES.standard)).toBe('Planning Questions');
    expect(planningPanelLabel(OBSERVATION_TYPES.workProduct)).toBe('Planning Questions');
    expect(planningPanelLabel(null)).toBe('Planning Questions');
  });
});
