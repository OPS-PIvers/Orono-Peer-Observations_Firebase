import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  type DocumentData,
  type QueryConstraint,
  collection,
  onSnapshot,
  query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface UseFirestoreCollectionResult<T> {
  data: (T & { id: string })[] | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribe to a Firestore collection and return the live snapshot as an
 * array. Caller passes constraints (where/orderBy/limit) — no opinion on
 * filtering.
 *
 * Backed by TanStack Query so the snapshot survives component unmounts
 * (default `gcTime` 5 min): navigating away and back returns cached data
 * instantly, and the underlying `onSnapshot` listener keeps streaming
 * updates while any observer is mounted.
 */
export function useFirestoreCollection<T = DocumentData>(
  collectionPath: string,
  constraints: QueryConstraint[] = [],
): UseFirestoreCollectionResult<T> {
  const queryClient = useQueryClient();
  // Stable key so callers can pass `constraints` inline without forcing a
  // resubscribe per render. Equivalent constraint *types* are treated as
  // equal — callers needing finer-grained keying should memoize.
  const constraintsKey = constraints.map((c) => c.type).join('|');
  const queryKey: QueryKey = ['firestore-collection', collectionPath, constraintsKey];

  const result = useQuery<(T & { id: string })[]>({
    queryKey,
    enabled: !!collectionPath,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      new Promise((resolve, reject) => {
        const ref = collection(db, collectionPath);
        const q = constraints.length > 0 ? query(ref, ...constraints) : ref;
        let resolvedFirst = false;
        const unsub = onSnapshot(
          q,
          (snap) => {
            const next = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T & { id: string });
            if (!resolvedFirst) {
              resolvedFirst = true;
              resolve(next);
            } else {
              queryClient.setQueryData(queryKey, next);
            }
          },
          (err) => {
            if (!resolvedFirst) {
              resolvedFirst = true;
              reject(err);
            } else {
              console.error('[useFirestoreCollection] subscription error', err);
            }
          },
        );
        signal.addEventListener('abort', unsub);
      }),
  });

  return {
    data: result.data ?? null,
    loading: !!collectionPath && result.isPending,
    error: result.error ?? null,
  };
}
