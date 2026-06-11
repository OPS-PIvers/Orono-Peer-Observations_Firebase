import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  type DocumentData,
  type QueryConstraint,
  collectionGroup,
  onSnapshot,
  query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface UseFirestoreCollectionGroupResult<T> {
  data: (T & { id: string; _path: string })[] | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribe to a Firestore collection-group and return the live snapshot as an
 * array. Each returned item carries `_path` (the document's full path) so
 * callers can derive parent paths (e.g. the staff email from a cross-staff
 * moduleProgress query).
 *
 * Semantics mirror useFirestoreCollection, including the TanStack Query cache
 * for no-flash remounts. Callers whose constraint *values* vary must pass those
 * values via `keyParts` to disambiguate cache keys — see useFirestoreCollection
 * for the full explanation.
 */
export function useFirestoreCollectionGroup<T = DocumentData>(
  groupName: string,
  constraints: QueryConstraint[] = [],
  keyParts: readonly (string | number | boolean)[] = [],
): UseFirestoreCollectionGroupResult<T> {
  const queryClient = useQueryClient();
  const constraintsKey = [constraints.map((c) => c.type).join('|'), ...keyParts].join('::');
  const queryKey: QueryKey = ['firestore-collection-group', groupName, constraintsKey];

  const cached = queryClient.getQueryData<(T & { id: string; _path: string })[]>(queryKey);
  const [data, setData] = useState<(T & { id: string; _path: string })[] | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!groupName) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const cachedNow = queryClient.getQueryData<(T & { id: string; _path: string })[]>(queryKey);
    if (cachedNow !== undefined) {
      setData(cachedNow);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    const ref = collectionGroup(db, groupName);
    const q = constraints.length > 0 ? query(ref, ...constraints) : ref;
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map(
          (d) =>
            ({ ...d.data(), id: d.id, _path: d.ref.path }) as T & { id: string; _path: string },
        );
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
  }, [groupName, constraintsKey, queryClient]);

  return { data, loading, error };
}
