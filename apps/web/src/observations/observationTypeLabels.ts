import { OBSERVATION_TYPES, SPECIAL_ROLES, type ObservationType } from '@ops/shared';

/** Option labels for the observation-type pickers. */
export const OBSERVATION_TYPE_OPTION_LABELS: Record<ObservationType, string> = {
  [OBSERVATION_TYPES.standard]: 'Standard observation',
  [OBSERVATION_TYPES.workProduct]: 'Work product',
  [OBSERVATION_TYPES.instructionalRound]: 'Instructional round',
};

/** Whether a role's views show observation types at all. Building
 *  Administrators run Standard observations only, so Work Product and
 *  Instructional Round labels, badges and columns are noise for them. */
export function showsObservationTypes(role: string | null | undefined): boolean {
  return role !== SPECIAL_ROLES.administrator;
}
