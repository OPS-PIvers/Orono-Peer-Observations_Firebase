import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';
import { OBSERVATION_YEARS } from '../constants.js';
import { DEFAULT_EMAIL_PREFERENCES, emailPreferences } from './emailTemplate.js';

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
  /** Self-service opt-in/out per non-critical email category (see
   *  emailTemplate.ts EMAIL_TRIGGER_CATEGORY). Missing/legacy docs parse as
   *  all-true — fully opted in, matching pre-existing behavior. */
  emailPreferences: emailPreferences.default(DEFAULT_EMAIL_PREFERENCES),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Staff = z.infer<typeof staff>;

/** Subset accepted from admin UI add/edit forms (ID + audit timestamps
 *  added server-side). */
export const staffInput = staff.omit({ createdAt: true, updatedAt: true });
export type StaffInput = z.infer<typeof staffInput>;

/**
 * One staff member's planned change in an annual cycle rollover (see the
 * applyStaffRollover callable). `fromYear` is an optimistic-concurrency
 * guard: the server skips (and reports) any row whose stored year no longer
 * matches what the admin previewed.
 */
export const staffRolloverEntry = z.object({
  email,
  fromYear: staffYear,
  toYear: staffYear,
  toSummativeYear: z.boolean(),
});
export type StaffRolloverEntry = z.infer<typeof staffRolloverEntry>;

export const applyStaffRolloverInput = z.object({
  entries: z.array(staffRolloverEntry).min(1).max(1000),
});
export type ApplyStaffRolloverInput = z.infer<typeof applyStaffRolloverInput>;

/** Callable response — per-email outcomes so the admin UI can report
 *  exactly what was (not) written. */
export interface ApplyStaffRolloverResult {
  applied: number;
  /** Emails whose stored year no longer matched `fromYear` (concurrent edit). */
  skippedStale: string[];
  /** Emails with no /staff doc (deleted since the preview loaded). */
  missing: string[];
}
