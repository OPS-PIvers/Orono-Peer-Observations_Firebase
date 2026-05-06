import { doc, serverTimestamp, writeBatch, type DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const FIRESTORE_BATCH_LIMIT = 500;

/**
 * Apply the same merge-patch to many documents in `collectionPath`,
 * chunking into Firestore's 500-write-per-batch limit. Always stamps
 * `updatedAt: serverTimestamp()` alongside the patch so audit fields
 * stay consistent with single-edit writes.
 *
 * `onProgress(done, total)` fires after each batch commits — pages can
 * use this to render a progress toast.
 */
export async function bulkMerge(
  collectionPath: string,
  ids: readonly string[],
  patch: DocumentData,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (ids.length === 0) return;
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
    await batch.commit();
    done += slice.length;
    onProgress?.(done, ids.length);
  }
}

/**
 * Per-row patch variant used by Add/Remove Building, where the next
 * value depends on the existing row contents. Caller supplies a
 * `computePatch(id)` callback that returns the merge-patch (or null
 * to skip).
 */
export async function bulkMergePerRow(
  collectionPath: string,
  ids: readonly string[],
  computePatch: (id: string) => DocumentData | null,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (ids.length === 0) return;
  let done = 0;
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
    if (writes > 0) await batch.commit();
    done += slice.length;
    onProgress?.(done, ids.length);
  }
}
