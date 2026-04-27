import { z } from 'zod';
import { isoDate, slugId } from './common.js';

/**
 * /roles/{roleId} — role definitions.
 *
 * Role data is admin-editable in v1. `roleId` is a slug derived from the
 * displayName (e.g., "Library Media Specialist" → "library-media-specialist").
 *
 * `isSpecialAccess` flags the three roles that get filter UI / view-all
 * permissions: Administrator, Peer Evaluator, Full Access. Custom claims
 * mirror this so security rules can enforce it without a DB roundtrip.
 *
 * `rubricId` references /rubrics/{rubricId} — usually equal to roleId, but
 * decoupled so multiple roles can share a rubric (e.g., grade-band
 * specialists pointing at a single Specialist rubric).
 */
export const role = z.object({
  roleId: slugId,
  displayName: z.string().trim().min(1).max(80),
  isSpecialAccess: z.boolean().default(false),
  rubricId: slugId,
  isActive: z.boolean().default(true),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Role = z.infer<typeof role>;

export const roleInput = role.omit({ createdAt: true, updatedAt: true });
export type RoleInput = z.infer<typeof roleInput>;
