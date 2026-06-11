import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DocumentData,
  type QueryConstraint,
  collection,
  getDocs,
  query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface UseFirestoreCollectionOnceResult<T> {
  data: (T & { id: string })[] | null;
  loading: boolean;
  /** True while a fetch (initial or a manual refresh) is in flight. */
  fetching: boolean;
  error: Error | null;
  /** Re-run the query on demand (there is no live listener). */
  refresh: () => void;
  /**
   * Apply a local transform to the cached rows without a refetch — e.g. merge
   * a patch that was just written so the UI reflects it immediately. No-op
   * until the initial fetch has populated the cache. Stable across renders.
   */
  mutate: (updater: (rows: (T & { id: string })[]) => (T & { id: string })[]) => void;
}

/**
 * One-shot read of a Firestore collection via `getDocs`, cached and shared
 * through TanStack Query — deliberately NOT a live `onSnapshot`. Use it for
 * large collections (e.g. the whole staff list) where a live listener would
 * re-render the page on every unrelated write; call `refresh()` to re-fetch,
 * or `mutate()` to fold a local write into the cached rows without one.
 *
 * Mirrors `useFirestoreCollection`'s constraint/keyParts contract: the cache
 * key keys on constraint *types* plus `keyParts`, so callers whose constraint
 * *values* vary must pass those values via `keyParts` to disambiguate.
 */
export function useFirestoreCollectionOnce<T = DocumentData>(
  collectionPath: string,
  constraints: QueryConstraint[] = [],
  keyParts: readonly (string | number | boolean)[] = [],
): UseFirestoreCollectionOnceResult<T> {
  const queryClient = useQueryClient();
  const constraintsKey = [constraints.map((c) => c.type).join('|'), ...keyParts].join('::');
  const result = useQuery({
    queryKey: ['firestore-collection-once', collectionPath, constraintsKey],
    enabled: !!collectionPath,
    queryFn: async () => {
      const ref = collection(db, collectionPath);
      const q = constraints.length > 0 ? query(ref, ...constraints) : ref;
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T & { id: string });
    },
  });

  const mutate = useCallback(
    (updater: (rows: (T & { id: string })[]) => (T & { id: string })[]) => {
      queryClient.setQueryData<(T & { id: string })[]>(
        ['firestore-collection-once', collectionPath, constraintsKey],
        // Returning undefined leaves the cache untouched (nothing fetched yet).
        (rows) => (rows === undefined ? undefined : updater(rows)),
      );
    },
    [queryClient, collectionPath, constraintsKey],
  );

  return {
    data: result.data ?? null,
    loading: result.isLoading,
    fetching: result.isFetching,
    error: result.error,
    refresh: () => {
      void result.refetch();
    },
    mutate,
  };
}
