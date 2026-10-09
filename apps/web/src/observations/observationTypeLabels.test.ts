import { describe, expect, it } from 'vitest';
import { OBSERVATION_TYPES, SPECIAL_ROLES } from '@ops/shared';
import { hasGoalsPanel, planningPanelLabel } from './observationTypeLabels';

describe('planningPanelLabel', () => {
  it('calls the pre-observation panel Observation Notes for Instructional Rounds only', () => {
    expect(planningPanelLabel(OBSERVATION_TYPES.instructionalRound)).toBe('Observation Notes');
    expect(planningPanelLabel(OBSERVATION_TYPES.standard)).toBe('Planning Questions');
    expect(planningPanelLabel(OBSERVATION_TYPES.workProduct)).toBe('Planning Questions');
    expect(planningPanelLabel(null)).toBe('Planning Questions');
  });
});

describe('hasGoalsPanel', () => {
  it('shows Goals & Next Steps on Work Product and Instructional Round', () => {
    expect(hasGoalsPanel(OBSERVATION_TYPES.workProduct)).toBe(true);
    expect(hasGoalsPanel(OBSERVATION_TYPES.instructionalRound)).toBe(true);
    expect(hasGoalsPanel(null)).toBe(false);
  });

  it('shows it on Standard observations unless an Administrator ran them', () => {
    expect(hasGoalsPanel(OBSERVATION_TYPES.standard, SPECIAL_ROLES.peerEvaluator)).toBe(true);
    expect(hasGoalsPanel(OBSERVATION_TYPES.standard, SPECIAL_ROLES.administrator)).toBe(false);
    // Docs created before observerRole was recorded.
    expect(hasGoalsPanel(OBSERVATION_TYPES.standard, undefined)).toBe(true);
  });
});
