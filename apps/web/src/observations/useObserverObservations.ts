import { useMemo } from 'react';
import { limit, where, type QueryConstraint } from 'firebase/firestore';
import { COLLECTIONS, toDate, type Observation } from '@ops/shared';
import { useAdminConsoleAccess } from '@/auth/adminConsoleAccess';
import { useEffectiveEmail } from '@/dev/DevModeContext';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';

type Row = Observation & { id: string };

export interface ObserverObservationsResult {
  data: Row[] | null;
  loading: boolean;
  error: Error | null;
  /** A query hit its page size, so "Load more" may find more. */
  hasMore: boolean;
  /** Every observation, not just the viewer's (console admins). */
  oversight: boolean;
}

const lastModifiedMs = (o: Row) => toDate(o.lastModifiedAt)?.getTime() ?? 0;

/**
 * Observations an observer may see, matching the /observations rules:
 * console admins (oversight) get one query across everyone; Peer Evaluators
 * and building Administrators get the ones they created plus the ones
 * shared with them as co-observer, merged newest first. Rules aren't
 * filters, so the observer scope has to be part of each query.
 *
 * `filters` are extra where() clauses (status, observedEmail); `orderBy`
 * must be on lastModifiedAt desc so the merge order matches.
 */
export function useObserverObservations(args: {
  enabled: boolean;
  filters: QueryConstraint[];
  orderBy: QueryConstraint;
  pageSize: number;
  keyParts: readonly (string | number | boolean)[];
}): ObserverObservationsResult {
  const { enabled, filters, orderBy, pageSize, keyParts } = args;
  const me = useEffectiveEmail();
  const { allowed: oversight, loading: accessLoading } = useAdminConsoleAccess();
  const ready = enabled && !accessLoading && !!me;

  const allConstraints = useMemo(
    () => [...filters, orderBy, limit(pageSize)],
    [filters, orderBy, pageSize],
  );
  const ownConstraints = useMemo(
    () => [where('observerEmail', '==', me), ...filters, orderBy, limit(pageSize)],
    [me, filters, orderBy, pageSize],
  );
  const sharedConstraints = useMemo(
    () => [where('coObserverEmails', 'array-contains', me), ...filters, orderBy, limit(pageSize)],
    [me, filters, orderBy, pageSize],
  );

  const all = useFirestoreCollection<Observation>(
    ready && oversight ? COLLECTIONS.observations : '',
    allConstraints,
    ['all', ...keyParts, pageSize],
  );
  const own = useFirestoreCollection<Observation>(
    ready && !oversight ? COLLECTIONS.observations : '',
    ownConstraints,
    ['own', me, ...keyParts, pageSize],
  );
  const shared = useFirestoreCollection<Observation>(
    ready && !oversight ? COLLECTIONS.observations : '',
    sharedConstraints,
    ['shared', me, ...keyParts, pageSize],
  );

  return useMemo<ObserverObservationsResult>(() => {
    if (oversight) {
      return {
        data: all.data,
        loading: all.loading,
        error: all.error,
        hasMore: all.data?.length === pageSize,
        oversight,
      };
    }
    const merged =
      own.data && shared.data
        ? Array.from(new Map([...own.data, ...shared.data].map((o) => [o.id, o])).values())
            .sort((a, b) => lastModifiedMs(b) - lastModifiedMs(a))
            .slice(0, pageSize)
        : null;
    return {
      data: merged,
      loading: own.loading || shared.loading,
      error: own.error ?? shared.error,
      hasMore: own.data?.length === pageSize || shared.data?.length === pageSize,
      oversight,
    };
  }, [oversight, all, own, shared, pageSize]);
}
