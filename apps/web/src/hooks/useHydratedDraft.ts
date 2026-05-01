import { useEffect, useRef } from 'react';

/**
 * Hydrate a local draft once per remote document. Subsequent snapshots —
 * including the latency-compensated one Firestore fires on the user's own
 * write — are ignored, so they don't clobber in-flight edits with
 * server-stale data. Resets when `id` changes (e.g. URL navigation).
 *
 * Navigation-race guard: if `source` carries its own `id` field (the shape
 * `useFirestoreDoc` returns), it must equal the `id` argument. This blocks
 * a render-cycle race where the previous doc's data is still hanging in
 * `useFirestoreDoc.data` for one render after the URL changes — without
 * the guard, the new page would permanently hydrate with the previous
 * page's content. Sources without an `id` field skip the check.
 *
 * The `hydrate` callback may have an unstable identity; further calls are
 * short-circuited by the doc-id guard, so re-running the effect is cheap.
 */
export function useHydratedDraft<T>(
  id: string | null | undefined,
  source: T | null | undefined,
  hydrate: (source: T) => void,
): void {
  const hydratedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) {
      hydratedIdRef.current = null;
      return;
    }
    if (!source) return;
    if (!sourceMatchesId(source, id)) return;
    if (hydratedIdRef.current === id) return;
    hydratedIdRef.current = id;
    hydrate(source);
  }, [id, source, hydrate]);
}

function sourceMatchesId(source: unknown, id: string): boolean {
  if (typeof source !== 'object' || source === null) return true;
  if (!('id' in source)) return true;
  const sourceId = source.id;
  if (typeof sourceId !== 'string') return true;
  return sourceId === id;
}
