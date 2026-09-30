import { OBSERVATION_TYPES, type ObservationType } from '@ops/shared';

/** Option labels for the observation-type pickers. */
export const OBSERVATION_TYPE_OPTION_LABELS: Record<ObservationType, string> = {
  [OBSERVATION_TYPES.standard]: 'Standard observation',
  [OBSERVATION_TYPES.workProduct]: 'Work product',
  [OBSERVATION_TYPES.instructionalRound]: 'Instructional round',
};
