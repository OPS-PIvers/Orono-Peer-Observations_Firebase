import { z } from 'zod';

/**
 * Shared primitive schemas. The convention across all entity schemas:
 *
 *   - Timestamps are modeled as `z.date()`. Firestore stores them as
 *     Timestamp objects; conversion happens at the read/write boundary
 *     (see the converter helpers in apps/functions and apps/web).
 *   - Email addresses are validated case-insensitively but stored
 *     lowercased.
 *   - Document IDs that are also slugs (roles, rubrics, work product
 *     questions) follow `lower-kebab-case`.
 *   - Multi-line rich text is stored as plain strings for now; rich-text
 *     editors (Tiptap) serialize their docs to JSON which we wrap in
 *     `tiptapDoc` below.
 */

export const isoDate = z.date();

export const email = z.email('Must be a valid email address').trim().toLowerCase();

export const slugId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Must be lower-kebab-case');

/** Tiptap document JSON — opaque blob for now; deeper validation lives in
 *  the editor itself. */
export const tiptapDoc = z.object({ type: z.literal('doc'), content: z.array(z.unknown()) });
export type TiptapDoc = z.infer<typeof tiptapDoc>;

/** Drive file reference — used for evidence, audio, and finalized PDFs. */
export const driveFileRef = z.object({
  driveFileId: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  uploadedAt: isoDate,
  uploadedBy: email.optional(),
});
export type DriveFileRef = z.infer<typeof driveFileRef>;

/** Used wherever something accepts a free-form metadata bag. Intentionally
 *  loose — security rules + per-collection schemas constrain what actually
 *  gets stored. */
export const metadata = z.record(z.string(), z.unknown());
