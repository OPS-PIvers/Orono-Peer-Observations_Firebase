import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';
import { PILL_COLORS, pillColor, type PillColorName } from './pillColor.js';
import { CYCLE_STATUSES, cycleStatus, displayYear } from '../cycle.js';
import type { Staff } from './staff.js';

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

/** Module chips use the shared pill-color palette (see pillColor.ts) so colors
 *  stay consistent and on-brand across modules, roles, buildings, etc. */
export const MODULE_COLORS = PILL_COLORS;
export type ModuleColor = PillColorName;
export const moduleColor = pillColor;

/** Curated lucide icon slugs an admin can pick for a module's sidebar entry.
 *  Keep in sync with apps/web/src/modules/moduleIcons.ts. */
export const MODULE_ICONS = [
  'shapes',
  'book-open',
  'graduation-cap',
  'users',
  'clipboard-list',
  'folder',
  'star',
  'compass',
  'lightbulb',
  'target',
  'library',
  'presentation',
] as const;
export type ModuleIcon = (typeof MODULE_ICONS)[number];
export const moduleIcon = z.enum(MODULE_ICONS);

/** The three section types an admin can compose a module page from. */
export const MODULE_SECTION_TYPES = ['richtext', 'resources', 'materials'] as const;
export type ModuleSectionType = (typeof MODULE_SECTION_TYPES)[number];
export const moduleSectionType = z.enum(MODULE_SECTION_TYPES);

/**
 * One ordered section on a module page. `body` carries Tiptap document JSON
 * (the `JSON.stringify` of a TiptapDoc), only meaningful for
 * `type === 'richtext'`; resources/materials sections pull their content from
 * the `/modules/{id}/items` subcollection by `sectionId`.
 */
export const moduleSection = z.object({
  /** Generated section slug (e.g. "sec-abc12"); not a domain slugId. */
  id: z.string().min(1).max(64),
  type: moduleSectionType,
  title: z.string().trim().max(120).default(''),
  /** Tiptap document JSON (richtext sections only). Intentionally not trimmed —
   *  the editor manages its own whitespace/markup. */
  body: z.string().default(''),
});
export type ModuleSection = z.infer<typeof moduleSection>;

/**
 * Auto-enable rule: a module can automatically apply to every staff member
 * matching ONE criterion — a cycle status OR a display year (never both, never
 * multiple values). `null` (the default) means manual assignment only.
 */
export const autoEnable = z.discriminatedUnion('dimension', [
  z.object({ dimension: z.literal('status'), value: z.enum(CYCLE_STATUSES) }),
  z.object({
    dimension: z.literal('year'),
    value: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
]);
export type AutoEnable = z.infer<typeof autoEnable>;

export const moduleDoc = z.object({
  moduleId: slugId,
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).default(''),
  color: moduleColor.default('blue'),
  isActive: z.boolean().default(true),
  /** When true the module has a staff-facing page + sidebar entry for
   *  assigned staff. When false it stays a display-only chip. */
  hasPage: z.boolean().default(false),
  /** Lucide icon slug for the sidebar entry. */
  icon: moduleIcon.default('shapes'),
  /** Ordered page layout. Content for resources/materials sections lives in
   *  the items subcollection; rich-text content lives inline on the section. */
  sections: z.array(moduleSection).default([]),
  /** When set, the module auto-applies to staff matching this single
   *  criterion, on top of any manual assignments. null = manual-only. */
  autoEnable: autoEnable.nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type ModuleDoc = z.infer<typeof moduleDoc>;

export const moduleInput = moduleDoc.omit({ createdAt: true, updatedAt: true });
export type ModuleInput = z.infer<typeof moduleInput>;

/**
 * Does this staff member satisfy a module's auto-enable rule? Mirrors the
 * inline cycle math in firestore.rules — keep the two in sync (rules tests
 * guard the rules side).
 */
export function staffMatchesAutoEnable(
  staff: Pick<Staff, 'year' | 'summativeYear'>,
  rule: AutoEnable | null | undefined,
): boolean {
  if (!rule) return false;
  if (rule.dimension === 'status') {
    return cycleStatus(staff.year, staff.summativeYear) === rule.value;
  }
  return displayYear(staff.year) === rule.value;
}
