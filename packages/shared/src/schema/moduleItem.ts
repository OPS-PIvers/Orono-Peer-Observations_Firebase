import { z } from 'zod';
import { localDate } from './buildingSchedule.js';
import { driveFileRef, email, isoDate, slugId } from './common.js';

/**
 * Hard upper bound (bytes) on a resource file an admin uploads to a module.
 * Matched between the client picker and the `uploadModuleFile` callable so a
 * file that would be rejected server-side never gets base64-encoded and sent.
 * 20 MB mirrors the observation-evidence limit and comfortably covers
 * handbooks/PDFs while respecting the callable request-size ceiling.
 */
export const MAX_MODULE_FILE_BYTES = 20 * 1024 * 1024;

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
  /** Which moduleSection.id this item renders under (a generated section
   *  slug, not a domain slugId). */
  sectionId: z.string().min(1).max(64),
  order: z.number().int().nonnegative().default(0),
  title: z.string().trim().min(1).max(200),
  // resource-only:
  fileUrl: z.url().optional(),
  /** Drive reference for a file uploaded via the `uploadModuleFile` callable.
   *  Present only when the resource is backed by an uploaded file (rather than
   *  an external `linkUrl`); lets the admin editor delete/replace the file and
   *  the renderer distinguish a hosted file from an external link. `fileUrl` is
   *  the file's webViewLink, kept alongside so the renderer can stay
   *  ref-agnostic. */
  driveFile: driveFileRef.optional(),
  linkUrl: z.url().optional(),
  // material-only:
  description: z.string().trim().max(2000).default(''),
  /** ISO calendar date (yyyy-mm-dd); optional. */
  dueDate: localDate.optional(),
  /** Optional deep link for the material's CTA. Kept a plain string (not
   *  z.url()) because it may be an in-app route like "/book/123". */
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
