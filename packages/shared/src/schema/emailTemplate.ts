import { z } from 'zod';
import { isoDate, slugId } from './common.js';

/**
 * /emailTemplates/{templateId} — admin-editable notification templates.
 *
 * v1 ships with one template ID: 'finalizedObservation'. Variables are
 * substituted at send time using a simple `{{varName}}` syntax.
 *
 * `bodyHtml` is the rendered (HTML) body. The admin UI shows a Tiptap
 * editor; the editor's serialized HTML is what we store.
 */

export const KNOWN_TEMPLATE_VARIABLES = [
  'observerName',
  'observerEmail',
  'observedName',
  'observedEmail',
  'observationDate',
  'observationName',
  'observedRole',
  'pdfDriveLink',
  'driveFolderLink',
  'appName',
] as const;
export type TemplateVariable = (typeof KNOWN_TEMPLATE_VARIABLES)[number];

export const emailTemplate = z.object({
  templateId: slugId,
  name: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1).max(200),
  bodyHtml: z.string().trim().min(1),
  /** The variables this template references. Validated against the rendered
   *  body at save time so we catch typos in `{{variableName}}` early. */
  variables: z.array(z.enum(KNOWN_TEMPLATE_VARIABLES)).default([]),
  isActive: z.boolean().default(true),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type EmailTemplate = z.infer<typeof emailTemplate>;

export const emailTemplateInput = emailTemplate.omit({ createdAt: true, updatedAt: true });
export type EmailTemplateInput = z.infer<typeof emailTemplateInput>;

export const FINALIZED_OBSERVATION_TEMPLATE_ID = 'finalizedObservation';
