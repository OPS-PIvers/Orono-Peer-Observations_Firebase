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

/** Label for the pre-observation questions panel. Instructional Rounds have
 *  no planning meeting — the teacher observes colleagues and takes notes. */
export function planningPanelLabel(type: ObservationType | null | undefined): string {
  return type === OBSERVATION_TYPES.instructionalRound ? 'Observation Notes' : 'Planning Questions';
}

/** Work Product and Instructional Round observations add a Goals & Next
 *  Steps panel to the meeting notes: one rich-text box, no questions. */
export function hasGoalsPanel(type: ObservationType | null | undefined): boolean {
  return type === OBSERVATION_TYPES.workProduct || type === OBSERVATION_TYPES.instructionalRound;
}
