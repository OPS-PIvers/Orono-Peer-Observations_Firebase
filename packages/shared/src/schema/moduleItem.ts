import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';

/**
 * /modules/{moduleId}/items/{itemId} — the resource and material content for a
 * module page. `moduleId` is denormalized onto each item so a single
 * collectionGroup('items') query can power the dashboard and so the recursive
 * security rule can gate reads by the viewer's assigned modules.
 */
export const MODULE_ITEM_KINDS = ['resource', 'material'] as const;
export type ModuleItemKind = (typeof MODULE_ITEM_KINDS)[number];
export const moduleItemKind = z.enum(MODULE_ITEM_KINDS);

export const moduleItem = z.object({
  itemId: z.string().min(1).max(64),
  moduleId: slugId,
  kind: moduleItemKind,
  /** Which moduleSection.id this item renders under. */
  sectionId: z.string().min(1).max(64),
  order: z.number().int().nonnegative().default(0),
  title: z.string().trim().min(1).max(200),
  // resource-only:
  fileUrl: z.url().optional(),
  linkUrl: z.url().optional(),
  // material-only:
  description: z.string().trim().max(2000).default(''),
  /** ISO calendar date (yyyy-mm-dd); optional. */
  dueDate: z.string().trim().optional(),
  /** Optional deep link for the material's CTA. */
  ctaUrl: z.string().trim().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type ModuleItem = z.infer<typeof moduleItem>;

export const moduleItemInput = moduleItem.omit({ createdAt: true, updatedAt: true });
export type ModuleItemInput = z.infer<typeof moduleItemInput>;

/**
 * /staff/{email}/moduleProgress/{itemId} — per-staff completion of a material
 * item. Stored under the staff member's own doc so rules are trivial. Absence
 * of a doc means "not done".
 */
export const moduleProgress = z.object({
  itemId: z.string().min(1).max(64),
  moduleId: slugId,
  status: z.literal('done'),
  completedAt: isoDate,
});
export type ModuleProgress = z.infer<typeof moduleProgress>;
