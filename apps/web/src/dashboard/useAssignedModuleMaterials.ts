import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import { MODULE_SUBCOLLECTIONS, chunkForInQuery, type ModuleItem } from '@ops/shared';
import { db } from '@/lib/firebase';

const EMPTY: ModuleItem[] = [];

export interface UseAssignedModuleMaterialsResult {
  materials: ModuleItem[];
  loading: boolean;
  error: Error | null;
}

/**
 * Read every `material` item belonging to `moduleIds`, via a
 * collectionGroup('items') query.
 *
 * Firestore caps an `in` filter at `FIRESTORE_IN_LIMIT` values, so the ids are
 * split into batches and each batch is queried separately — a staff member
 * with more than that many effective modules gets all of their materials
 * rather than silently losing everything past the cap. Batches are disjoint by
 * `moduleId`, but results are still keyed by `moduleId/itemId` so a duplicate
 * could never double-render.
 *
 * One-shot (`getDocs`), not a live listener, matching what the dashboard did
 * before; `loading`/`error` mirror `useFirestoreCollectionOnce`.
 */
export function useAssignedModuleMaterials(
  moduleIds: readonly string[],
): UseAssignedModuleMaterialsResult {
  // Sorted so two renders that produce the same set in a different order share
  // one cache entry (and one round-trip).
  const ids = useMemo(() => [...new Set(moduleIds)].sort(), [moduleIds]);
  const idsKey = ids.join(',');

  const result = useQuery({
    queryKey: ['assigned-module-materials', idsKey],
    enabled: ids.length > 0,
    queryFn: async () => {
      const snaps = await Promise.all(
        chunkForInQuery(ids).map((batch) =>
          getDocs(
            query(
              collectionGroup(db, MODULE_SUBCOLLECTIONS.items),
              where('kind', '==', 'material'),
              where('moduleId', 'in', batch),
            ),
          ),
        ),
      );
      const byKey = new Map<string, ModuleItem>();
      for (const snap of snaps) {
        for (const d of snap.docs) {
          const item = d.data() as ModuleItem;
          byKey.set(`${item.moduleId}/${item.itemId}`, item);
        }
      }
      return [...byKey.values()];
    },
  });

  return {
    materials: result.data ?? EMPTY,
    loading: result.isLoading,
    error: result.error,
  };
}
