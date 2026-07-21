import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import {
  type QueryConstraint,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  isAdminRole,
  type Observation,
  type ObservationStatus,
  type Role,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { db } from '@/lib/firebase';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useNewObservationsDisabled } from '@/hooks/useNewObservationsDisabled';
import { roleDisplayName } from '@/utils/roleLookup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type StatusFilter = ObservationStatus | 'all';
type ObservationRow = Observation & { id: string };

// This collection accumulates every observation district-wide, forever —
// bound the live query with a page size and grow it via "Load more" rather
// than ever streaming the full history.
const PAGE_SIZE = 50;

// Cap on each individual "search older records" lookup query — keeps the
// on-demand server-side search bounded, same spirit as PAGE_SIZE above.
const EXTRA_SEARCH_LIMIT = 25;

/**
 * Landing page for PEs and admins (special-access roles). Shows the
 * observations they can see, filtered by status and free-text search.
 *
 * Admins / Full Access: see all observations.
 * Peer Evaluators: see all observations (security rules enforce — they
 *   technically have hasSpecialAccess and can list everything).
 * Teachers / specialists: don't reach this page; they're routed to MyRubric.
 */
export function ObservationsListPage() {
  const { user, claims } = useAuth();
  const isAdmin = isAdminRole(claims.role);
  const newObservationsDisabled = useNewObservationsDisabled();

  // Status comes from the URL (?status=draft|finalized) so the sidebar's
  // In-progress / Finalized / All observations links land on the right view.
  // The enum values are capitalised ("Draft"/"Finalized"), so match the
  // lowercase URL param case-insensitively.
  const [searchParams] = useSearchParams();
  const statusParam = (searchParams.get('status') ?? '').toLowerCase();
  const statusFilter: StatusFilter =
    statusParam === OBSERVATION_STATUS.draft.toLowerCase()
      ? OBSERVATION_STATUS.draft
      : statusParam === OBSERVATION_STATUS.finalized.toLowerCase()
        ? OBSERVATION_STATUS.finalized
        : 'all';
  const [search, setSearch] = useState('');
  const [showAllPEs, setShowAllPEs] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  // Reset back to the first page whenever the filter changes — otherwise a
  // widened `limit()` from a previous filter would carry over and briefly
  // over-fetch the new selection.
  useEffect(() => {
    setPageSize(PAGE_SIZE);
  }, [statusFilter, showAllPEs, isAdmin, user?.email]);

  // Constraints stay stable per filter selection. Admins default to "all
  // PEs"; non-admin PEs default to "just mine" with a toggle to widen.
  const constraints = useMemo<QueryConstraint[]>(() => {
    const cs: QueryConstraint[] = [orderBy('lastModifiedAt', 'desc'), limit(pageSize)];
    if (statusFilter !== 'all') {
      cs.unshift(where('status', '==', statusFilter));
    }
    if (!isAdmin && !showAllPEs && user?.email) {
      cs.unshift(where('observerEmail', '==', user.email.toLowerCase()));
    }
    return cs;
  }, [statusFilter, showAllPEs, isAdmin, user?.email, pageSize]);

  const {
    data: observations,
    loading,
    error,
  } = useFirestoreCollection<Observation>(COLLECTIONS.observations, constraints, [
    statusFilter,
    showAllPEs,
    isAdmin,
    user?.email?.toLowerCase() ?? '',
    // `limit()`'s value isn't reflected in the hook's constraint-type key
    // (only constraint *types* are, per useFirestoreCollection's docs), so
    // pageSize must be threaded through keyParts to force a resubscribe
    // when "Load more" grows the page.
    pageSize,
  ]);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);

  const filtered = useMemo(() => {
    if (!observations) return [];
    const q = search.trim().toLowerCase();
    if (!q) return observations;
    return observations.filter(
      (o) =>
        o.observedName.toLowerCase().includes(q) ||
        o.observedEmail.toLowerCase().includes(q) ||
        o.observerEmail.toLowerCase().includes(q) ||
        o.observationName.toLowerCase().includes(q),
    );
  }, [observations, search]);

  // Bounded server-side lookup, triggered on demand when the free-text
  // search comes up empty against the loaded page. Runs exact-match
  // queries on the email fields and prefix (`>=`/`<= `) queries on the
  // name fields, scoped the same way the live subscription is (status
  // filter + "mine only" for non-admin PEs), and merges hits into the view.
  const [extraResults, setExtraResults] = useState<ObservationRow[] | null>(null);
  const [extraSearchedFor, setExtraSearchedFor] = useState<string | null>(null);
  const [searchingExtra, setSearchingExtra] = useState(false);
  const [extraSearchError, setExtraSearchError] = useState<string | null>(null);

  // Any change that invalidates the extra results (new search text, or the
  // scope/filters the search was run under changing) clears them so a stale
  // "no matches" doesn't linger.
  useEffect(() => {
    setExtraResults(null);
    setExtraSearchedFor(null);
    setExtraSearchError(null);
  }, [search, statusFilter, showAllPEs, isAdmin, user?.email]);

  async function searchOlderRecords() {
    const q = search.trim();
    if (!q) return;
    setSearchingExtra(true);
    setExtraSearchError(null);
    try {
      const qLower = q.toLowerCase();
      const scope =
        !isAdmin && !showAllPEs && user?.email
          ? where('observerEmail', '==', user.email.toLowerCase())
          : null;
      const ref = collection(db, COLLECTIONS.observations);
      // Firestore string ranges are case-sensitive but the local filter this
      // lookup backstops matches case-insensitively — run each name prefix
      // query with the text as typed plus lowercase and Title Case variants
      // so e.g. "smith" still finds "Smith Jones" in older records.
      const prefixVariants = Array.from(
        new Set([
          q,
          qLower,
          qLower.replace(/(^|\s)(\S)/g, (_m, ws: string, ch: string) => ws + ch.toUpperCase()),
        ]),
      );
      const queryPlans: QueryConstraint[][] = [
        [
          ...(scope ? [scope] : []),
          where('observedEmail', '==', qLower),
          limit(EXTRA_SEARCH_LIMIT),
        ],
      ];
      for (const prefix of prefixVariants) {
        for (const field of ['observedName', 'observationName'] as const) {
          queryPlans.push([
            ...(scope ? [scope] : []),
            where(field, '>=', prefix),
            where(field, '<=', prefix + '\uf8ff'),
            orderBy(field),
            limit(EXTRA_SEARCH_LIMIT),
          ]);
        }
      }
      // observerEmail exact-match is only a distinct query when the view
      // isn't already scoped to "mine" — otherwise it's redundant with scope.
      if (!scope) {
        queryPlans.push([where('observerEmail', '==', qLower), limit(EXTRA_SEARCH_LIMIT)]);
      }

      const snaps = await Promise.all(queryPlans.map((cs) => getDocs(query(ref, ...cs))));
      const loadedIds = new Set((observations ?? []).map((o) => o.id));
      const merged = new Map<string, ObservationRow>();
      for (const snap of snaps) {
        for (const d of snap.docs) {
          if (loadedIds.has(d.id)) continue;
          merged.set(d.id, { ...(d.data() as Observation), id: d.id });
        }
      }
      // Status wasn't included as a query-level equality (to avoid a
      // combinatorial explosion of composite indexes) — apply it client-side
      // over the small, already-bounded result set instead.
      const results = Array.from(merged.values()).filter(
        (o) => statusFilter === 'all' || o.status === statusFilter,
      );
      setExtraResults(results);
      setExtraSearchedFor(q);
    } catch (err) {
      setExtraSearchError(err instanceof Error ? err.message : 'Failed to search older records');
    } finally {
      setSearchingExtra(false);
    }
  }

  const combined = useMemo<(ObservationRow & { isExtraResult: boolean })[]>(() => {
    const primary = filtered.map((o) => ({ ...o, isExtraResult: false }));
    if (!extraResults || extraResults.length === 0) return primary;
    // Re-dedupe against the live page at render time: extraResults was only
    // deduped when the search ran, and "Load more" can later pull the same
    // doc into the subscription — without this a row (and its React key)
    // would appear twice.
    const primaryIds = new Set(primary.map((o) => o.id));
    return [
      ...primary,
      ...extraResults
        .filter((o) => !primaryIds.has(o.id))
        .map((o) => ({ ...o, isExtraResult: true })),
    ];
  }, [filtered, extraResults]);

  const hasSearchText = search.trim().length > 0;
  const noLocalMatches = hasSearchText && filtered.length === 0;
  const extraSearchStale = extraSearchedFor !== search.trim();

  return (
    <PageHeader
      title="Observations"
      subtitle={
        observations
          ? extraResults && extraResults.length > 0
            ? `${String(combined.length)} of ${String(observations.length)} loaded (+${String(extraResults.length)} found in older records)`
            : `${String(filtered.length)} of ${String(observations.length)} observations`
          : 'Loading…'
      }
      actions={
        newObservationsDisabled ? (
          <Button
            variant="outline"
            disabled
            title="New observation creation is currently disabled by an administrator."
            className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            <Plus />
            New observation
          </Button>
        ) : (
          <Button
            asChild
            variant="outline"
            className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            <Link to="/observations/new">
              <Plus />
              New observation
            </Link>
          </Button>
        )
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by observed name, email, or observation name"
            className="pl-9"
          />
        </div>
        {!isAdmin ? (
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAllPEs}
              onChange={(e) => setShowAllPEs(e.target.checked)}
              className="h-4 w-4"
            />
            Include observations by other PEs
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load observations: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-ops-blue text-white">
            <TableRow>
              <TableHead>Observed</TableHead>
              <TableHead>Observer</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-32">Type</TableHead>
              <TableHead className="w-32">Last modified</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !observations ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`skeleton-${String(i)}`}>
                  <TableCell>
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-56" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-44" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-7 w-14" />
                  </TableCell>
                </TableRow>
              ))
            ) : observations?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  No observations yet. Click &quot;New observation&quot; to start one.
                </TableCell>
              </TableRow>
            ) : combined.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  {noLocalMatches ? (
                    <div className="flex flex-col items-center gap-2">
                      <p>
                        Searched all {String(observations?.length ?? 0)} loaded observation
                        {observations?.length === 1 ? '' : 's'}; no matches.
                      </p>
                      {extraResults !== null && !extraSearchStale ? (
                        <p>No matches in older records either.</p>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void searchOlderRecords()}
                          disabled={searchingExtra}
                        >
                          {searchingExtra ? 'Searching older records…' : 'Search older records'}
                        </Button>
                      )}
                      {extraSearchError ? (
                        <p className="text-destructive text-xs">{extraSearchError}</p>
                      ) : null}
                    </div>
                  ) : (
                    'No observations match those filters.'
                  )}
                </TableCell>
              </TableRow>
            ) : (
              combined.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{o.observedName || o.observedEmail}</span>
                      {o.isExtraResult ? (
                        <span className="border-border text-muted-foreground inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap">
                          Older record
                        </span>
                      ) : null}
                    </div>
                    {o.observationName ? (
                      <div className="text-muted-foreground text-xs">{o.observationName}</div>
                    ) : null}
                    <div className="text-muted-foreground text-xs">
                      {roleDisplayName(roles, o.observedRole)} · Year {String(o.observedYear)}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{o.observerEmail}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{o.type}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatRelative(o.lastModifiedAt)}
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/observations/${o.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {observations?.length === pageSize ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => setPageSize((n) => n + PAGE_SIZE)}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </PageHeader>
  );
}

function StatusBadge({ status }: { status: ObservationStatus }) {
  if (status === OBSERVATION_STATUS.draft) {
    return (
      <span className="inline-flex items-center rounded border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
        Draft
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded border border-green-200 bg-green-100 px-2 py-0.5 text-xs text-green-800">
      Finalized
    </span>
  );
}

function formatRelative(value: Observation['lastModifiedAt']): string {
  // Firestore Timestamp objects have a toDate() method; Date objects work
  // directly. The schema types value as Date but actual runtime data may
  // be either depending on whether onSnapshot has converted it yet — cast
  // to unknown first so the runtime narrowing is allowed.
  const raw = value as unknown;
  const date =
    raw instanceof Date
      ? raw
      : typeof raw === 'object' && raw !== null && 'toDate' in raw
        ? (raw as { toDate: () => Date }).toDate()
        : null;
  if (!date) return '—';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${String(diffDay)}d ago`;
  return date.toLocaleDateString();
}
