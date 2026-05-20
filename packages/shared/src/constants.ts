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
  modules: 'modules',
  buildings: 'buildings',
  rubrics: 'rubrics',
  roleYearMappings: 'roleYearMappings',
  observations: 'observations',
  workProductQuestions: 'workProductQuestions',
  emailTemplates: 'emailTemplates',
  appSettings: 'appSettings',
  auditLog: 'auditLog',
  transcriptionJobs: 'transcriptionJobs',
  mail: 'mail',
  dashboardQuickMaterials: 'dashboardQuickMaterials',
  buildingSchedules: 'buildingSchedules',
  signupFields: 'signupFields',
  observationWindows: 'observationWindows',
  userCalendarTokens: 'userCalendarTokens',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/** Subcollections under /observationWindows/{windowId}. */
export const WINDOW_SUBCOLLECTIONS = {
  slots: 'slots',
  preferences: 'preferences',
} as const;

/** Observation window lifecycle states. */
export const OBSERVATION_WINDOW_STATUS = {
  open: 'open',
  partiallyBooked: 'partially-booked',
  fullyBooked: 'fully-booked',
  cancelled: 'cancelled',
  expired: 'expired',
} as const;

export type ObservationWindowStatus =
  (typeof OBSERVATION_WINDOW_STATUS)[keyof typeof OBSERVATION_WINDOW_STATUS];

/** Slot states within a window. */
export const OBSERVATION_SLOT_STATUS = {
  available: 'available',
  booked: 'booked',
  blocked: 'blocked',
} as const;

export type ObservationSlotStatus =
  (typeof OBSERVATION_SLOT_STATUS)[keyof typeof OBSERVATION_SLOT_STATUS];

/** Why an otherwise-available slot is blocked. */
export const SLOT_BLOCKED_REASON = {
  noSchool: 'no-school',
  peConflict: 'pe-conflict',
  windowCancelled: 'window-cancelled',
} as const;

export type SlotBlockedReason = (typeof SLOT_BLOCKED_REASON)[keyof typeof SLOT_BLOCKED_REASON];

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
