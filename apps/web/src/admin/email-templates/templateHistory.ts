import type { EmailTemplateHistoryEntry } from '@ops/shared';

/** Matches emailTemplate.history's `.max(5)` in packages/shared/src/schema/
 *  emailTemplate.ts — keep these in sync. */
export const MAX_TEMPLATE_HISTORY = 5;

/**
 * Build the next `history` array for a template save: the pre-edit
 * subject/body become one new entry, prepended onto the existing history
 * and trimmed to the most recent MAX_TEMPLATE_HISTORY entries (oldest
 * drops off first).
 *
 * `editedBy`/`editedAt` describe *this* save (the acting admin and time it
 * happens) rather than whoever originally authored `previous` — the doc has
 * no earlier per-save attribution to draw on, so the save that retires a
 * version is the best available attribution for it.
 */
export function withHistoryEntry(
  existing: EmailTemplateHistoryEntry[] | undefined,
  previous: { subject: string; bodyHtml: string },
  editedBy: string,
  editedAt: Date = new Date(),
): EmailTemplateHistoryEntry[] {
  const entry: EmailTemplateHistoryEntry = {
    subject: previous.subject,
    bodyHtml: previous.bodyHtml,
    editedAt,
    editedBy,
  };
  return [entry, ...(existing ?? [])].slice(0, MAX_TEMPLATE_HISTORY);
}
