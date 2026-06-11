import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';
import { ALLOWED_EMAIL_DOMAIN, OBSERVATION_YEARS } from '../constants.js';

/**
 * /staff/{email} — staff directory.
 *
 * Note on year/probationary mapping (mirrors GAS Constants.js):
 *   1, 2, 3 = continuing-contract years
 *   4, 5, 6 = probationary years P1, P2, P3
 *
 * `summativeYear` is true in years where a staff member receives a summative
 * (vs formative) evaluation. Drives some default observation behaviors.
 *
 * `buildings` is a string array — staff can be assigned to multiple buildings
 * (e.g., a counselor at both OMS and OHS).
 *
 * Document ID is the staff member's email (lowercased). This makes lookups
 * by email O(1) without an index.
 */

export const staffYear = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export type StaffYear = z.infer<typeof staffYear>;

export function isStaffYear(value: unknown): value is StaffYear {
  return typeof value === 'number' && (OBSERVATION_YEARS as readonly number[]).includes(value);
}

export const staff = z.object({
  email,
  name: z.string().trim().min(1, 'Name is required').max(120),
  role: z.string().trim().min(1, 'Role is required').max(80),
  year: staffYear,
  buildings: z.array(z.string().trim().min(1).max(80)).default([]),
  modules: z.array(slugId).default([]),
  summativeYear: z.boolean().default(false),
  isActive: z.boolean().default(true),
  /** Grants admin-console access independent of professional role. */
  hasAdminAccess: z.boolean().default(false),
  /**
   * Module IDs that are excluded from auto-enable rules for this staff member.
   * When a module's `autoEnable` rule would normally include this staff member,
   * an entry here lets an admin carve out a per-person exception ("all Year-2
   * staff except Jane"). Manual assignments in `modules` are unaffected.
   */
  moduleExclusions: z.array(slugId).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Staff = z.infer<typeof staff>;

/** Subset accepted from admin UI add/edit forms (ID + audit timestamps
 *  added server-side). */
export const staffInput = staff.omit({ createdAt: true, updatedAt: true });
export type StaffInput = z.infer<typeof staffInput>;

/** Options controlling how strictly staff input is validated. */
export interface ValidateStaffInputOptions {
  /**
   * When true, the email must belong to `ALLOWED_EMAIL_DOMAIN`
   * (`@orono.k12.mn.us`). Off by default so imports and admin edits can
   * stage staff records before SSO is enforced.
   */
  enforceDomain?: boolean;
}

/**
 * Discriminated result of {@link validateStaffInput}. Mirrors Zod's
 * `safeParse` shape but flattens the error to a single human-readable string
 * so callers (web forms, callables, the import script) get a consistent
 * message without depending on Zod's internal error structure.
 */
export type ValidateStaffInputResult =
  | { success: true; data: StaffInput }
  | { success: false; error: string };

/**
 * Validate raw staff form/import input against the {@link staffInput} schema,
 * with optional domain enforcement.
 *
 * Email is normalized to lowercase by the schema before any checks run, so
 * domain enforcement is case-insensitive.
 *
 * @param input    Unknown payload from a form, callable, or import row.
 * @param options  See {@link ValidateStaffInputOptions}.
 */
export function validateStaffInput(
  input: unknown,
  options: ValidateStaffInputOptions = {},
): ValidateStaffInputResult {
  const parsed = staffInput.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }

  if (options.enforceDomain && !parsed.data.email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    return {
      success: false,
      error: `Email must belong to the ${ALLOWED_EMAIL_DOMAIN} domain.`,
    };
  }

  return { success: true, data: parsed.data };
}
