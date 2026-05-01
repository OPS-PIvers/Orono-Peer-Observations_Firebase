import { useEffect, useRef } from 'react';

/**
 * Hydrate a local draft once per remote document. Subsequent snapshots —
 * including the latency-compensated one Firestore fires on the user's own
 * write — are ignored, so they don't clobber in-flight edits with
 * server-stale data. Resets when `id` changes (e.g. URL navigation).
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
    if (hydratedIdRef.current === id) return;
    hydratedIdRef.current = id;
    hydrate(source);
  }, [id, source, hydrate]);
}
