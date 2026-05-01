import { useEffect, useState } from 'react';
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
 * Subscribe to a Firestore collection and return the live snapshot as
 * an array. Caller passes constraints (where/orderBy/limit) — no opinion
 * on filtering.
 *
 * Use this for admin pages that need real-time updates as data changes
 * (e.g. another admin tab updates the staff list while this one's open).
 *
 * For one-shot fetches, use TanStack Query with `getDocs` instead.
 */
export function useFirestoreCollection<T = DocumentData>(
  collectionPath: string,
  constraints: QueryConstraint[] = [],
): UseFirestoreCollectionResult<T> {
  const [data, setData] = useState<(T & { id: string })[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Stable key so the effect doesn't re-subscribe on every render due to
  // a new constraints array reference. Constraints with the same
  // type sequence are treated as equivalent — callers should keep their
  // constraint arrays stable (memoize, don't construct inline) for
  // anything more sophisticated than that.
  const constraintsKey = constraints.map((c) => c.type).join('|');

  useEffect(() => {
    // Empty path is the "don't subscribe yet" sentinel — used by callers
    // that want to mount this hook conditionally without violating the
    // rules of hooks. Mirrors `useFirestoreDoc`'s behavior.
    if (!collectionPath) {
      setLoading(false);
      setError(null);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);

    const ref = collection(db, collectionPath);
    const q = constraints.length > 0 ? query(ref, ...constraints) : ref;

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T & { id: string });
        setData(next);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- constraintsKey is the dep
  }, [collectionPath, constraintsKey]);

  return { data, loading, error };
}
