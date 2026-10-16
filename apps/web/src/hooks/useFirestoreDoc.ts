import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { type DocumentData, doc, onSnapshot } from 'firebase/firestore';
import { hydrateFirestoreDoc } from '@ops/shared';
import { db } from '@/lib/firebase';
import { reportDocRepair } from '@/lib/firestoreDiagnostics';

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
 * The snapshot is run through `hydrateFirestoreDoc`, which fills in the
 * schema defaults for any field the stored document omits. Without that,
 * `T` lies: `z.infer` counts a `.default()` field as always-present while
 * the raw document may never have had it written.
 *
 * Subscription lifecycle is tied to the component mount; the TanStack
 * Query cache is used to share the last-known snapshot across mounts so
 * remounts return data synchronously and don't flash `Loading…`.
 *
 * Pass `{ cached: false }` when the caller copies the document into a local
 * draft that it later writes back (`useHydratedDraft`). The cached copy can
 * be minutes old — another device, a co-observer or a server write may have
 * changed the document since — and a draft hydrated from it would write that
 * stale content back over the newer edits on the next save. With the cache
 * off, `data` stays null and `loading` true until this mount's own live
 * snapshot arrives. The live snapshot still refreshes the cache for others.
 */
export function useFirestoreDoc<T = DocumentData>(
  docPath: string,
  options: { cached?: boolean } = {},
): UseFirestoreDocResult<T> {
  const useCache = options.cached ?? true;
  const queryClient = useQueryClient();
  const queryKey: QueryKey = ['firestore-doc', docPath];

  const cached = useCache
    ? queryClient.getQueryData<(T & { id: string }) | null>(queryKey)
    : undefined;
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
    const cachedNow = useCache
      ? queryClient.getQueryData<(T & { id: string }) | null>(queryKey)
      : undefined;
    if (cachedNow !== undefined) {
      setData(cachedNow);
      setLoading(false);
    } else {
      // Drop the previous path's data too, so a draft can't hydrate from it.
      if (!useCache) setData(null);
      setLoading(true);
    }
    setError(null);

    const unsubscribe = onSnapshot(
      doc(db, docPath),
      (snap) => {
        const next = snap.exists()
          ? hydrateFirestoreDoc<T>(docPath, snap.data(), snap.id, reportDocRepair)
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
  }, [docPath, queryClient, useCache]);

  return { data, loading, error };
}
