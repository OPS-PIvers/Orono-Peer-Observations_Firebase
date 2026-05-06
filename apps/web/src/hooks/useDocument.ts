import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type DocumentReference, onSnapshot } from 'firebase/firestore';

/**
 * Subscribe to a single Firestore document by reference. Like
 * `useFirestoreDoc` but takes a `DocumentReference` so the caller can
 * pass a typed ref (e.g. one built from `withConverter`).
 *
 * Subscription lifecycle is tied to the component mount; the TanStack
 * Query cache is used to share the last-known snapshot across mounts so
 * remounts return data synchronously and don't flash `Loading…`.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useDocument<T>(ref: DocumentReference | null): {
  data: (T & { id: string }) | null;
  loading: boolean;
  error: Error | null;
} {
  const queryClient = useQueryClient();
  const path = ref?.path ?? '';
  const queryKey: QueryKey = ['firestore-doc-ref', path];

  const cached = queryClient.getQueryData<(T & { id: string }) | null>(queryKey);
  const [data, setData] = useState<(T & { id: string }) | null>(cached ?? null);
  const [loading, setLoading] = useState(!!ref && cached === undefined);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!ref) {
      setData(null);
      setLoading(false);
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
      ref,
      (snap) => {
        const next = snap.exists() ? ({ id: snap.id, ...snap.data() } as T & { id: string }) : null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- queryKey is derived from path
  }, [path, queryClient]);

  return { data, loading, error };
}
