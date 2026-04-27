/**
 * Cross-cutting constants used by web, functions, and pdf-renderer.
 *
 * Anything that's "policy" (role list, default settings) lives here.
 * Anything that's "configuration" (rate limits, app name, branding overrides)
 * lives in Firestore /appSettings/global so admins can edit it.
 */

/** The only email domain allowed to authenticate. */
export const ALLOWED_EMAIL_DOMAIN = 'orono.k12.mn.us';

/** Firestore collection paths — single source of truth. */
export const COLLECTIONS = {
  staff: 'staff',
  roles: 'roles',
  rubrics: 'rubrics',
  roleYearMappings: 'roleYearMappings',
  observations: 'observations',
  workProductQuestions: 'workProductQuestions',
  emailTemplates: 'emailTemplates',
  appSettings: 'appSettings',
  auditLog: 'auditLog',
  transcriptionJobs: 'transcriptionJobs',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Observation lifecycle states. */
export const OBSERVATION_STATUS = {
  draft: 'Draft',
  finalized: 'Finalized',
} as const;

export type ObservationStatus = (typeof OBSERVATION_STATUS)[keyof typeof OBSERVATION_STATUS];

/** Observation types (carried over from GAS Constants.js). */
export const OBSERVATION_TYPES = {
  standard: 'Standard',
  workProduct: 'Work Product',
  instructionalRound: 'Instructional Round',
} as const;

export type ObservationType = (typeof OBSERVATION_TYPES)[keyof typeof OBSERVATION_TYPES];

/** Observation years 1-3 + probationary years 1-3. */
export const OBSERVATION_YEARS = [1, 2, 3, 4, 5, 6] as const;
export type ObservationYear = (typeof OBSERVATION_YEARS)[number];

/** Probationary year mapping (matches GAS Constants.js semantics). */
export const PROB_YEARS = { p1: 4, p2: 5, p3: 6 } as const;
