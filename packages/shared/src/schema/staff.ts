import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';
import { OBSERVATION_YEARS } from '../constants.js';
import { CYCLE_STATUSES, type CycleStatus, cycleStatus } from '../cycle.js';
import { DEFAULT_EMAIL_PREFERENCES, emailPreferences } from './emailTemplate.js';

/**
 * /staff/{email} — staff directory.
 *
 * Note on year/probationary mapping (mirrors GAS Constants.js):
 *   1, 2, 3 = continuing-contract years
 *   4, 5, 6 = probationary years P1, P2, P3
 *
 * `year` and `cycleStatus` are independent. Year alone decides assigned
 * domains (roleYearMappings); status is its own admin-set label. Read status
 * through `staffCycleStatus`, which falls back to the legacy derivation for
 * docs written before `cycleStatus` was stored.
 *
 * `summativeYear` is true in years where a staff member receives a summative
 * (vs formative) evaluation. It follows status (High Cycle / Probationary) and
 * is written in sync with every status change — see `cycleStatusFields`.
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
  /** Stored cycle status. Optional (no default) so a doc that predates the
   *  field keeps parsing and reads its status via the legacy fallback in
   *  `staffCycleStatus` rather than a default that would silently relabel it. */
  cycleStatus: z.enum(CYCLE_STATUSES).optional(),
  isActive: z.boolean().default(true),
  /** Grants admin-console access independent of professional role. */
  hasAdminAccess: z.boolean().default(false),
  /** Self-service opt-in/out per non-critical email category (see
   *  emailTemplate.ts EMAIL_TRIGGER_CATEGORY). Missing/legacy docs parse as
   *  all-true — fully opted in, matching pre-existing behavior. */
  emailPreferences: emailPreferences.default(DEFAULT_EMAIL_PREFERENCES),
  /**
   * Denormalized "most recent time this person authenticated into the app",
   * stamped by the `syncMyClaims` callable (apps/functions/src/auth/
   * syncMyClaims.ts) — the first thing the web client calls after sign-in.
   *
   * `null` (or an absent field, on docs created before this stamp existed)
   * means "invited but never signed in". The admin rollout-readiness card
   * (apps/web/src/admin/dashboard/NeverSignedInCard.tsx) deliberately does
   * NOT rely on an equality filter for this: Firestore's
   * `where('lastSignInAt','==',null)` only matches documents where the field
   * is *present and null*, never documents that omit it, which would make
   * the card fragile to any staff-creation path that forgets to write the
   * null. Instead the card queries `isActive == true` alone and checks
   * "null or missing" client-side. `scripts/backfill/backfill-last-sign-in.ts`
   * stamps real history from Firebase Auth's user records for docs that
   * predate this field.
   *
   * Not part of `staffInput` on purpose — no admin form or CSV import may
   * write it, so a routine staff edit can never clobber a real sign-in stamp.
   */
  lastSignInAt: isoDate.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Staff = z.infer<typeof staff>;

/** Subset accepted from admin UI add/edit forms (ID + audit timestamps
 *  added server-side; `lastSignInAt` is stamped only by the sign-in path). */
export const staffInput = staff.omit({ createdAt: true, updatedAt: true, lastSignInAt: true });
export type StaffInput = z.infer<typeof staffInput>;

/**
 * One staff member's planned change in an annual cycle rollover (see the
 * applyStaffRollover callable). `fromYear` is an optimistic-concurrency
 * guard: the server skips (and reports) any row whose stored year no longer
 * matches what the admin previewed.
 *
 * `toCycleStatus` is the status to write (with its synced `summativeYear`).
 * `toSummativeYear` is the pre-status field, still accepted so a client and
 * callable deployed at different times keep working: the web client sends
 * both, and an entry carrying only `toSummativeYear` derives its status the
 * legacy way.
 */
export const staffRolloverEntry = z
  .object({
    email,
    fromYear: staffYear,
    toYear: staffYear,
    toCycleStatus: z.enum(CYCLE_STATUSES).optional(),
    toSummativeYear: z.boolean().optional(),
  })
  .refine((e) => e.toCycleStatus !== undefined || e.toSummativeYear !== undefined, {
    message: 'toCycleStatus is required',
    path: ['toCycleStatus'],
  });
export type StaffRolloverEntry = z.infer<typeof staffRolloverEntry>;

/** The status a rollover entry writes: `toCycleStatus`, or — for an entry
 *  from a pre-status client — the legacy derivation of its target year. */
export function rolloverEntryCycleStatus(entry: StaffRolloverEntry): CycleStatus {
  return entry.toCycleStatus ?? cycleStatus(entry.toYear, entry.toSummativeYear ?? false);
}

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
