import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';

/**
 * /modules/{moduleId} — admin-defined participation tracks (e.g. Mentor,
 * Mentee, Instructional Leadership Team). Staff get an array of these on
 * their own doc; the dashboard renders them as colored chips next to the
 * primary role.
 *
 * Modules are intentionally separate from `/roles` — they don't have
 * rubrics, year mappings, or special-access semantics. They're just a
 * scoped display + future unlock surface.
 */

/** Fixed color palette so chips stay on-brand. New colors go here, not in
 *  per-module hex codes. */
export const MODULE_COLORS = [
  'blue',
  'red',
  'emerald',
  'amber',
  'purple',
  'indigo',
  'pink',
  'gray',
] as const;
export type ModuleColor = (typeof MODULE_COLORS)[number];
export const moduleColor = z.enum(MODULE_COLORS);

export const moduleDoc = z.object({
  moduleId: slugId,
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).default(''),
  color: moduleColor.default('blue'),
  isActive: z.boolean().default(true),
  createdAt: isoDate,
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type ModuleDoc = z.infer<typeof moduleDoc>;

export const moduleInput = moduleDoc.omit({ createdAt: true, updatedAt: true });
export type ModuleInput = z.infer<typeof moduleInput>;
