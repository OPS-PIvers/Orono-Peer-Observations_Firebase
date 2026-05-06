import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type DocumentData, doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface UseFirestoreDocResult<T> {
  data: (T & { id: string }) | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribe to a single Firestore document. Returns null if the document
 * doesn't exist (vs. an undefined "not loaded yet" state — `loading`
 * tracks that separately).
 *
 * Subscription lifecycle is tied to the component mount; the TanStack
 * Query cache is used to share the last-known snapshot across mounts so
 * remounts return data synchronously and don't flash `Loading…`.
 */
export function useFirestoreDoc<T = DocumentData>(docPath: string): UseFirestoreDocResult<T> {
  const queryClient = useQueryClient();
  const queryKey: QueryKey = ['firestore-doc', docPath];

  const cached = queryClient.getQueryData<(T & { id: string }) | null>(queryKey);
  // Empty path is the "no doc yet" sentinel — callers gate on `loading`
  // until they have a real path. Match the legacy hook by starting in
  // `loading: true` for empty path.
  const [data, setData] = useState<(T & { id: string }) | null>(cached ?? null);
  const [loading, setLoading] = useState(!docPath || cached === undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!docPath) {
      setData(null);
      setLoading(true);
      setError(null);
      return;
    }
    const cachedNow = queryClient.getQueryData<(T & { id: string }) | null>(queryKey);
    if (cachedNow !== undefined) {
      setData(cachedNow);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    const unsubscribe = onSnapshot(
      doc(db, docPath),
      (snap) => {
        const next = snap.exists()
          ? ({ ...(snap.data() as T), id: snap.id } as T & { id: string })
          : null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is derived from docPath
  }, [docPath, queryClient]);

  return { data, loading, error };
}
