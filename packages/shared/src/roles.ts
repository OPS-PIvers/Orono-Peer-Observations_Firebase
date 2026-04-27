/**
 * Role definitions.
 *
 * Note: in v1, admins can add/rename/remove roles via the admin UI; the
 * source of truth is the Firestore /roles collection. This file holds the
 * canonical *initial* seed (matching what the GAS Constants.js had) plus
 * the small subset of roles the app treats as "special access" (admin /
 * peer evaluator), which still needs to be code-defined because security
 * rules and route guards depend on it.
 */

/** Roles with elevated permissions (filter UI, view all observations, etc.). */
export const SPECIAL_ROLES = {
  administrator: 'Administrator',
  peerEvaluator: 'Peer Evaluator',
  fullAccess: 'Full Access',
} as const;

export type SpecialRole = (typeof SPECIAL_ROLES)[keyof typeof SPECIAL_ROLES];

/** Default seed roles imported from the GAS Constants.AVAILABLE_ROLES list. */
export const SEED_ROLES = [
  'Teacher',
  'Administrator',
  'Peer Evaluator',
  'Full Access',
  'Nurse',
  'Counselor',
  'Special Education',
  'Speech Language Pathologist',
  'Social Worker',
  'Psychologist',
  'Instructional Coach',
  'Library Media Specialist',
  'Occupational Therapist',
  'Physical Therapist',
] as const;

export type SeedRole = (typeof SEED_ROLES)[number];

export function isSpecialRole(role: string | null | undefined): role is SpecialRole {
  return (
    role === SPECIAL_ROLES.administrator ||
    role === SPECIAL_ROLES.peerEvaluator ||
    role === SPECIAL_ROLES.fullAccess
  );
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === SPECIAL_ROLES.administrator || role === SPECIAL_ROLES.fullAccess;
}
