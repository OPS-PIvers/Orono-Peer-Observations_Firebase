import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
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
 * Subscription lifecycle is tied to the component mount (useEffect cleanup
 * unsubs on unmount). The TanStack Query cache is used solely to share
 * data across mounts — on remount within `gcTime` the previous snapshot
 * is returned synchronously so there's no `Loading…` flash, and a fresh
 * `onSnapshot` reattaches in the same effect to keep streaming updates.
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

  const cached = queryClient.getQueryData<(T & { id: string })[]>(queryKey);
  const [data, setData] = useState<(T & { id: string })[] | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!collectionPath) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const cachedNow = queryClient.getQueryData<(T & { id: string })[]>(queryKey);
    if (cachedNow !== undefined) {
      setData(cachedNow);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    const ref = collection(db, collectionPath);
    const q = constraints.length > 0 ? query(ref, ...constraints) : ref;
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T & { id: string });
        queryClient.setQueryData(queryKey, next);
        setData(next);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- constraintsKey is the dep
  }, [collectionPath, constraintsKey, queryClient]);

  return { data, loading, error };
}
