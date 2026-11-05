import { useMemo } from 'react';
import { limit, where, type QueryConstraint } from 'firebase/firestore';
import { COLLECTIONS, toDate, type Observation } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useObservationOversight } from '@/auth/observationOversight';
import { useEffectiveEmail, useIsViewingAs } from '@/dev/DevModeContext';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { ownDraftGate, withGate } from './ownDraftGate';

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
 * Full Access (oversight) gets one query across everyone; Peer Evaluators
 * and building Administrators get the ones they created plus the ones
 * shared with them as co-observer, merged newest first. Rules aren't
 * filters, so the observer scope has to be part of each query.
 *
 * `status` and `observedEmail` narrow every query; `orderBy` must be on
 * lastModifiedAt desc so the merge order matches.
 *
 * A reader who gets in through canReadAllObservations() (the oversight
 * query, or any query while viewing as someone else) may not list their own
 * Draft observations, so those queries also carry {@link ownDraftGate}.
 */
export function useObserverObservations(args: {
  enabled: boolean;
  status?: string | null;
  observedEmail?: string | null;
  orderBy: QueryConstraint;
  pageSize: number;
  keyParts: readonly (string | number | boolean)[];
}): ObserverObservationsResult {
  const { enabled, status = null, observedEmail = null, orderBy, pageSize, keyParts } = args;
  const me = useEffectiveEmail();
  const { user } = useAuth();
  const readerEmail = user?.email ?? null;
  const viewingAs = useIsViewingAs();
  const { allowed: oversight, loading: accessLoading } = useObservationOversight();
  const ready = enabled && !accessLoading && !!me;

  const allConstraints = useMemo(() => {
    const filters = scopeFilters(status, observedEmail);
    const gate = ownDraftGate(readerEmail, { status, observedEmail });
    return [...withGate(filters, gate), orderBy, limit(pageSize)];
  }, [status, observedEmail, readerEmail, orderBy, pageSize]);
  // Own and shared queries pass on the reader's own access, except while
  // viewing as someone else, when they read through View As.
  const ownConstraints = useMemo(() => {
    const filters = [where('observerEmail', '==', me), ...scopeFilters(status, observedEmail)];
    const gate = viewingAs ? ownDraftGate(readerEmail, { status, observedEmail }) : [];
    return [...withGate(filters, gate), orderBy, limit(pageSize)];
  }, [me, status, observedEmail, viewingAs, readerEmail, orderBy, pageSize]);
  const sharedConstraints = useMemo(() => {
    const filters = [
      where('coObserverEmails', 'array-contains', me),
      ...scopeFilters(status, observedEmail),
    ];
    const gate = viewingAs ? ownDraftGate(readerEmail, { status, observedEmail }) : [];
    return [...withGate(filters, gate), orderBy, limit(pageSize)];
  }, [me, status, observedEmail, viewingAs, readerEmail, orderBy, pageSize]);
  const gateKey = viewingAs || oversight ? (readerEmail ?? '') : '';
  const parts = [...keyParts, status ?? '', observedEmail ?? '', gateKey];

  const all = useFirestoreCollection<Observation>(
    ready && oversight ? COLLECTIONS.observations : '',
    allConstraints,
    ['all', ...parts, pageSize],
  );
  const own = useFirestoreCollection<Observation>(
    ready && !oversight ? COLLECTIONS.observations : '',
    ownConstraints,
    ['own', me, ...parts, pageSize],
  );
  const shared = useFirestoreCollection<Observation>(
    ready && !oversight ? COLLECTIONS.observations : '',
    sharedConstraints,
    ['shared', me, ...parts, pageSize],
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

function scopeFilters(status: string | null, observedEmail: string | null) {
  return [
    ...(status ? [where('status', '==', status)] : []),
    ...(observedEmail ? [where('observedEmail', '==', observedEmail)] : []),
  ];
}
