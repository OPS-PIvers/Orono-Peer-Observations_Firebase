import { z } from 'zod';
import { isoDate, slugId } from './common.js';

/**
 * /rubrics/{rubricId} — full rubric definition for a role.
 *
 * Structure mirrors the Danielson Framework variant the GAS app shipped:
 *   4 domains × 5-6 components × 4 proficiency levels + look-fors.
 *
 * Component IDs follow the GAS convention (e.g., "1a", "2c", "3e") and are
 * referenced by /settings/roleYearMappings (which subset is active for a
 * given role-year combo) and by observations (which carry per-component
 * proficiency / lookfors / notes).
 *
 * NOTE: this schema is the source-of-truth for what the rubric editor in
 * Phase 3 produces. Keep it shaped for *ergonomic editing*, not for raw
 * sheet parity — the import script in Phase 2d translates the sheet
 * structure into this shape.
 */

export const componentId = z
  .string()
  .min(2)
  .max(8)
  .regex(/^[1-9][a-z]$/, 'Component IDs follow Danielson convention: digit + letter (e.g. 1a)');

export const proficiencyLevel = z.union([
  z.literal('developing'),
  z.literal('basic'),
  z.literal('proficient'),
  z.literal('distinguished'),
]);
export type ProficiencyLevel = z.infer<typeof proficiencyLevel>;

export const PROFICIENCY_LEVELS = ['developing', 'basic', 'proficient', 'distinguished'] as const;

export const proficiencyDescriptors = z.object({
  developing: z.string().trim().default(''),
  basic: z.string().trim().default(''),
  proficient: z.string().trim().default(''),
  distinguished: z.string().trim().default(''),
});
export type ProficiencyDescriptors = z.infer<typeof proficiencyDescriptors>;

export const rubricLookFor = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
});
export type RubricLookFor = z.infer<typeof rubricLookFor>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #RRGGBB hex string');

export const componentColor = z.object({
  bg: hexColor,
  fg: hexColor,
});
export type ComponentColor = z.infer<typeof componentColor>;

export const rubricComponent = z.object({
  id: componentId,
  title: z.string().trim().min(1).max(200),
  proficiencyLevels: proficiencyDescriptors,
  lookFors: z.array(rubricLookFor).default([]),
  color: componentColor.optional(),
});
export type RubricComponent = z.infer<typeof rubricComponent>;

export const rubricDomain = z.object({
  id: z.string().min(1).max(8),
  name: z.string().trim().min(1).max(120),
  components: z.array(rubricComponent).min(1),
});
export type RubricDomain = z.infer<typeof rubricDomain>;

export const rubric = z.object({
  rubricId: slugId,
  displayName: z.string().trim().min(1).max(80),
  domains: z.array(rubricDomain).min(1),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Rubric = z.infer<typeof rubric>;

export const rubricInput = rubric.omit({ createdAt: true, updatedAt: true });
export type RubricInput = z.infer<typeof rubricInput>;

/** Helper: flatten a rubric into a flat array of all component IDs in
 *  display order. Used by the role/year settings matrix and the rubric
 *  form's component navigation. */
export function flattenRubricComponentIds(r: Rubric | RubricInput): string[] {
  return r.domains.flatMap((d) => d.components.map((c) => c.id));
}
