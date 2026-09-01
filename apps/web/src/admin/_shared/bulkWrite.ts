import { doc, serverTimestamp, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const FIRESTORE_BATCH_LIMIT = 500;

/**
 * Raised when a chunked bulk write fails partway through.
 *
 * Firestore has no rollback across batches: once chunk 1 commits, those
 * writes are durable whatever chunk 2 does. An admin who is told only
 * "it failed" cannot tell whether re-running is safe, so the count that
 * survived travels with the error rather than being discarded.
 *
 * `written` is exact, not a floor — a batch commits all-or-nothing, so the
 * chunk that rejected contributed no documents.
 *
 * Thrown instead of returned so the existing callers that only `await` and
 * catch (BuildingsPage, RolesPage, ModulesPage, WorkProductPage,
 * SignupFieldsPage, staffCsv) keep working untouched; callers that want the
 * count opt in by narrowing on `instanceof`.
 */
export class BulkWriteError extends Error {
  /** Documents durably committed before the failing chunk. */
  readonly written: number;
  /** Ids the call was handed. For `bulkMergePerRow` this counts rows
   *  considered, which is not the same as rows it would have written. */
  readonly total: number;

  constructor(cause: unknown, written: number, total: number) {
    super(cause instanceof Error ? cause.message : 'Bulk write failed.', { cause });
    this.name = 'BulkWriteError';
    this.written = written;
    this.total = total;
  }
}

/**
 * Apply the same merge-patch to many documents in `collectionPath`,
 * chunking into Firestore's 500-write-per-batch limit. Always stamps
 * `updatedAt: serverTimestamp()` alongside the patch so audit fields
 * stay consistent with single-edit writes.
 *
 * `onProgress(done, total)` fires after each batch commits — pages can
 * use this to render a progress toast.
 *
 * Resolves with the number of documents written; throws `BulkWriteError`
 * carrying that same count if a chunk fails.
 */
export async function bulkMerge(
  collectionPath: string,
  ids: readonly string[],
  patch: DocumentData,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (ids.length === 0) return 0;
  let done = 0;
  for (let i = 0; i < ids.length; i += FIRESTORE_BATCH_LIMIT) {
    const slice = ids.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const id of slice) {
      batch.set(
        doc(db, collectionPath, id),
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
    try {
      await batch.commit();
    } catch (err) {
      throw new BulkWriteError(err, done, ids.length);
    }
    done += slice.length;
    onProgress?.(done, ids.length);
  }
  return done;
}

/**
 * Per-row patch variant used by Add/Remove Building, where the next
 * value depends on the existing row contents. Caller supplies a
 * `computePatch(id)` callback that returns the merge-patch (or null
 * to skip).
 *
 * Resolves with the number of documents written, which is at most
 * `ids.length` — skipped rows are never counted. `onProgress` still
 * reports rows *considered*, so a progress bar advances evenly across a
 * selection that is mostly no-ops.
 */
export async function bulkMergePerRow(
  collectionPath: string,
  ids: readonly string[],
  computePatch: (id: string) => DocumentData | null,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (ids.length === 0) return 0;
  let done = 0;
  let written = 0;
  for (let i = 0; i < ids.length; i += FIRESTORE_BATCH_LIMIT) {
    const slice = ids.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = writeBatch(db);
    let writes = 0;
    for (const id of slice) {
      const patch = computePatch(id);
      if (patch === null) continue;
      batch.set(
        doc(db, collectionPath, id),
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true },
      );
      writes += 1;
    }
    if (writes > 0) {
      try {
        await batch.commit();
      } catch (err) {
        throw new BulkWriteError(err, written, ids.length);
      }
      written += writes;
    }
    done += slice.length;
    onProgress?.(done, ids.length);
  }
  return written;
}
