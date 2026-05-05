import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
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
 * Backed by TanStack Query so cached data survives unmounts; the live
 * `onSnapshot` listener keeps streaming updates while any observer is
 * mounted.
 */
export function useFirestoreDoc<T = DocumentData>(docPath: string): UseFirestoreDocResult<T> {
  const queryClient = useQueryClient();
  const queryKey: QueryKey = ['firestore-doc', docPath];

  const result = useQuery<(T & { id: string }) | null>({
    queryKey,
    // Empty path is the "no doc yet" sentinel callers use when the doc
    // ID depends on data still loading. Disabling here preserves the
    // legacy `loading: true, data: null` shape (see return mapping
    // below) — `doc(db, '')` would throw if we tried to subscribe.
    enabled: !!docPath,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    queryFn: ({ signal }) =>
      new Promise((resolve, reject) => {
        let resolvedFirst = false;
        const unsub = onSnapshot(
          doc(db, docPath),
          (snap) => {
            const next = snap.exists()
              ? ({ ...(snap.data() as T), id: snap.id } as T & { id: string })
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
              console.error('[useFirestoreDoc] subscription error', err);
            }
          },
        );
        signal.addEventListener('abort', unsub);
      }),
  });

  // Empty path preserves the legacy "treat as loading" sentinel — callers
  // depend on `loading: true` to gate render until they have a real path.
  const loading = !docPath || result.isPending;

  return {
    data: result.data ?? null,
    loading,
    error: result.error ?? null,
  };
}
