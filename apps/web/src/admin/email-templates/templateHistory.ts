import { Timestamp } from 'firebase/firestore';
import { MAX_TEMPLATE_HISTORY_ENTRIES, type EmailTemplateHistoryEntry } from '@ops/shared';

/** Re-exported under its historical local name so existing imports keep
 *  working. The single source of truth for the cap is
 *  MAX_TEMPLATE_HISTORY_ENTRIES in packages/shared/src/schema/emailTemplate.ts
 *  (also referenced by that schema's `.max()`), so this file and the schema
 *  can no longer drift out of sync via a duplicated bare literal. */
export const MAX_TEMPLATE_HISTORY = MAX_TEMPLATE_HISTORY_ENTRIES;

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
  return [entry, ...(existing ?? [])].slice(0, MAX_TEMPLATE_HISTORY_ENTRIES);
}

/**
 * Firestore's hard per-document limit is 1 MiB (1,048,576 bytes). We budget
 * well under that so the doc's other fields, Firestore's own per-field
 * encoding overhead, and the gap between this JSON-based estimate and
 * Firestore's actual wire encoding all have headroom.
 */
export const SAFE_TEMPLATE_DOCUMENT_BYTES = 900_000;

function estimateByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Trim-to-fit safety net: drops the OLDEST history entries (history is
 * newest-first, so "oldest" is the end of the array) until the serialized
 * `{ ...liveFields, history }` document fits under `maxBytes`.
 *
 * Nothing in apps/ ever calls `.parse()`/`.safeParse()` on the emailTemplate
 * schema for this write path, so the Zod `.max(5)` never actually runs —
 * this function is what genuinely enforces both the version cap (it never
 * returns more than MAX_TEMPLATE_HISTORY_ENTRIES entries) and, more
 * importantly, a byte budget that the cap alone can't guarantee: a raw-HTML
 * editor that accepts pasted base64 images means even a single history
 * entry can be huge.
 *
 * This is invisible in normal use — ordinary templates never approach the
 * budget — and engages only to prevent an oversized template from
 * permanently wedging every future save on it. Even if trimming away every
 * history entry still doesn't fit, this returns an empty array rather than
 * throwing: the live content is what must be saved, and losing history is
 * the acceptable degradation, never a blocked save.
 */
export function fitHistoryToByteBudget(
  liveFields: Record<string, unknown>,
  history: EmailTemplateHistoryEntry[],
  maxBytes: number = SAFE_TEMPLATE_DOCUMENT_BYTES,
): EmailTemplateHistoryEntry[] {
  let trimmed = history.slice(0, MAX_TEMPLATE_HISTORY_ENTRIES);
  while (trimmed.length > 0 && estimateByteSize({ ...liveFields, history: trimmed }) > maxBytes) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

/**
 * The subset of EmailTemplateHistoryEntry that historyEntryKey needs, with
 * `editedAt` widened to also accept a raw Firestore Timestamp. The Zod
 * schema types `editedAt` as `Date`, but a plain (non-parsed) Firestore
 * client SDK snapshot — which is what the live `history` array actually is
 * at runtime — hands back a Timestamp instance instead; see
 * formatHistoryTimestamp in EmailTemplatesPage.tsx for the same real-world
 * mismatch.
 */
export type HistoryEntryLike = Pick<EmailTemplateHistoryEntry, 'subject'> & {
  editedAt: EmailTemplateHistoryEntry['editedAt'] | Timestamp;
};

/**
 * Stable identity for a history entry, independent of its position in the
 * live-updating `history` array. Array position shifts the moment another
 * admin's save prepends a new entry — keying a preview selection by index
 * would silently swap the previewed content to a different, unrelated
 * version at the same position. `editedAt` may be a Firestore Timestamp
 * (read back from a live snapshot) or a plain Date (staged client-side
 * before the write resolves) — normalize both to milliseconds.
 */
export function historyEntryKey(entry: HistoryEntryLike): string {
  const { editedAt } = entry;
  const date = editedAt instanceof Timestamp ? editedAt.toDate() : editedAt;
  const editedAtKey = date instanceof Date ? String(date.getTime()) : String(editedAt);
  return `${editedAtKey}::${entry.subject}`;
}
