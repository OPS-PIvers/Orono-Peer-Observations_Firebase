import type { RepairReporter } from '@ops/shared';

const reported = new Set<string>();

/**
 * Dev-only reporter for `hydrateFirestoreDoc`. The read boundary substitutes
 * an empty array/object when a stored document is missing a field the schema
 * marks required, which keeps the page up — but that document really is
 * malformed, so say so once per field instead of letting it render as an
 * empty section nobody can explain.
 *
 * No-ops in production: end users can't act on it, and a broken document that
 * appears in a list would otherwise log on every snapshot.
 */
export const reportDocRepair: RepairReporter | undefined = import.meta.env.DEV
  ? (fieldPath, kind) => {
      if (reported.has(fieldPath)) return;
      reported.add(fieldPath);
      console.warn(
        `[firestore] ${fieldPath} is missing but the schema requires it — ` +
          `substituted an empty ${kind} so the page still renders. Fix the document.`,
      );
    }
  : undefined;
