import type { ProficiencyLevel } from '@ops/shared';

/** Display names for the four proficiency levels. Kept in its own module so
 *  non-React consumers (e.g. the print builder) can import it without
 *  pulling in the grid and its Firebase-backed dependencies. */
export const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  developing: 'Developing',
  basic: 'Basic',
  proficient: 'Proficient',
  distinguished: 'Distinguished',
};
