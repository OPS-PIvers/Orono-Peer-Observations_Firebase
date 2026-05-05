import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type DocumentReference, onSnapshot } from 'firebase/firestore';

/**
 * Subscribe to a single Firestore document by reference. Like
 * `useFirestoreDoc` but takes a `DocumentReference` so the caller can
 * pass a typed ref (e.g. one built from `withConverter`).
 *
 * Backed by TanStack Query so cached data survives unmounts; the live
 * `onSnapshot` listener keeps streaming updates while any observer is
 * mounted.
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

  const result = useQuery<(T & { id: string }) | null>({
    queryKey,
    enabled: !!ref,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      new Promise((resolve, reject) => {
        if (!ref) {
          resolve(null);
          return;
        }
        let resolvedFirst = false;
        const unsub = onSnapshot(
          ref,
          (snap) => {
            const next = snap.exists()
              ? ({ id: snap.id, ...snap.data() } as T & { id: string })
              : null;
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
              console.error('[useDocument] subscription error', err);
            }
          },
        );
        signal.addEventListener('abort', unsub);
      }),
  });

  return {
    data: result.data ?? null,
    loading: !!ref && result.isPending,
    error: result.error ?? null,
  };
}
