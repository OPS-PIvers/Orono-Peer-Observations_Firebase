/**
 * Role definitions.
 *
 * Note: in v1, admins can add/rename/remove roles via the admin UI; the
 * source of truth is the Firestore /roles collection. Each role doc has
 * a `roleId` slug (lower-kebab-case) and a human-readable `displayName`.
 *
 * `staff.role`, `obs.observedRole`, and the `role` custom claim all store
 * the **slug** (e.g. `"administrator"`), not the displayName. Migrating
 * to slugs decouples staff/observation records from role renames. UI
 * sites resolve slug → displayName via the loaded /roles collection.
 *
 * The hardcoded sets below name the slug-form of the three "special"
 * roles, since security rules and route guards depend on them and can't
 * fetch the roles collection on the request hot path.
 */

/** Roles with elevated permissions (filter UI, view all observations, etc.). */
export const SPECIAL_ROLES = {
  administrator: 'administrator',
  peerEvaluator: 'peer-evaluator',
  fullAccess: 'full-access',
} as const;

export type SpecialRole = (typeof SPECIAL_ROLES)[keyof typeof SPECIAL_ROLES];

/** Default seed roles imported from the GAS Constants.AVAILABLE_ROLES list.
 *  Stored as { roleId, displayName } pairs so importers can seed the
 *  /roles collection in one shot. */
export const SEED_ROLES = [
  { roleId: 'teacher', displayName: 'Teacher' },
  { roleId: 'administrator', displayName: 'Administrator' },
  { roleId: 'peer-evaluator', displayName: 'Peer Evaluator' },
  { roleId: 'full-access', displayName: 'Full Access' },
  { roleId: 'nurse', displayName: 'Nurse' },
  { roleId: 'counselor', displayName: 'Counselor' },
  { roleId: 'special-education', displayName: 'Special Education' },
  { roleId: 'speech-language-pathologist', displayName: 'Speech Language Pathologist' },
  { roleId: 'social-worker', displayName: 'Social Worker' },
  { roleId: 'psychologist', displayName: 'Psychologist' },
  { roleId: 'instructional-coach', displayName: 'Instructional Coach' },
  { roleId: 'library-media-specialist', displayName: 'Library Media Specialist' },
  { roleId: 'occupational-therapist', displayName: 'Occupational Therapist' },
  { roleId: 'physical-therapist', displayName: 'Physical Therapist' },
] as const;

export type SeedRole = (typeof SEED_ROLES)[number]['roleId'];

/** Slugify a role displayName the same way the admin UI does — lower-case,
 *  non-alphanumerics → '-', collapsed and trimmed. Used by the
 *  displayName→roleId migration to map legacy free-text role values. */
export function slugifyRoleName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

/** Whether a staff member may use the Admin Console and its console-only
 *  data (rubrics, roles, settings, templates, roster-wide staff edits, the
 *  migration callables). Narrower than `isAdminRole(role) || hasAdminAccess`
 *  (the `isAdmin` claim): building Administrators keep `isAdmin` for managing
 *  observations and their building's staff, but only get the console when
 *  their staff doc also has `hasAdminAccess`. Mirrored by `isConsoleAdmin()`
 *  in firestore.rules. */
export function canOpenAdminConsole(
  role: string | null | undefined,
  hasAdminAccess: boolean | null | undefined,
): boolean {
  return role === SPECIAL_ROLES.fullAccess || hasAdminAccess === true;
}

/** Whether a role may start observations. Keyed on the role alone, NOT the
 *  `hasAdminAccess` staff flag: that flag grants the Admin Console to people
 *  whose own role is observed (e.g. a specialist), and must not turn them
 *  into observers. Mirrored by the observation create rule in firestore.rules. */
export function canCreateObservations(role: string | null | undefined): boolean {
  return isSpecialRole(role);
}
