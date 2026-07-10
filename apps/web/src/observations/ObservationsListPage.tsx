import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { type QueryConstraint, limit, orderBy, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  isAdminRole,
  type Observation,
  type ObservationStatus,
  type Role,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
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

// This collection accumulates every observation district-wide, forever —
// bound the live query with a page size and grow it via "Load more" rather
// than ever streaming the full history.
const PAGE_SIZE = 50;

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

  return (
    <PageHeader
      title="Observations"
      subtitle={
        observations
          ? `${String(filtered.length)} of ${String(observations.length)} observations`
          : 'Loading…'
      }
      actions={
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
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  {observations?.length === 0
                    ? 'No observations yet. Click "New observation" to start one.'
                    : 'No observations match those filters.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.observedName || o.observedEmail}</div>
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
