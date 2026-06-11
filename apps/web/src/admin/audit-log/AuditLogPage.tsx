import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type QueryConstraint,
  type QueryDocumentSnapshot,
  Timestamp,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';
import { AUDIT_ACTIONS, COLLECTIONS, type AuditLog } from '@ops/shared';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import { AdminDataView, type ColumnDef } from '@/admin/_shared/AdminDataView';

const PAGE_SIZE = 50;

/** Sorted, de-duplicated list of action values for the filter dropdown. */
const ACTION_OPTIONS = [...new Set(Object.values(AUDIT_ACTIONS))].sort((a, b) =>
  a.localeCompare(b),
);

/** Matches a syntactically-complete email so we only fire a server query once
 *  the user has typed a full address (avoids a query per keystroke). */
const COMPLETE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface LogEntry extends AuditLog {
  id: string;
}

interface ServerFilters {
  action: string;
  userEmail: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: ServerFilters = { action: '', userEmail: '', dateFrom: '', dateTo: '' };

/** Build the server-side query constraints for the current filter state. The
 *  `userEmail` filter only applies once the value is a complete email. */
function buildConstraints(filters: ServerFilters): QueryConstraint[] {
  const constraints: QueryConstraint[] = [orderBy('timestamp', 'desc')];
  if (filters.action) constraints.push(where('action', '==', filters.action));
  if (COMPLETE_EMAIL.test(filters.userEmail.trim())) {
    constraints.push(where('userEmail', '==', filters.userEmail.trim()));
  }
  if (filters.dateFrom) {
    constraints.push(where('timestamp', '>=', Timestamp.fromDate(new Date(filters.dateFrom))));
  }
  if (filters.dateTo) {
    // Include the whole "to" day by pushing to the end of that local day.
    const end = new Date(filters.dateTo);
    end.setHours(23, 59, 59, 999);
    constraints.push(where('timestamp', '<=', Timestamp.fromDate(end)));
  }
  return constraints;
}

export function AuditLogPage() {
  const [filters, setFilters] = useState<ServerFilters>(EMPTY_FILTERS);
  /** Client-side-only filter: narrows already-loaded rows by target substring. */
  const [targetFilter, setTargetFilter] = useState('');

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Debounced snapshot of the server-side filters. Typing into the email box
  // updates `filters` immediately (so inputs stay responsive) but only flushes
  // to `appliedFilters` after a short pause, so we don't fire a query per
  // keystroke. The fetch effect depends only on `appliedFilters`.
  const [appliedFilters, setAppliedFilters] = useState<ServerFilters>(EMPTY_FILTERS);
  useEffect(() => {
    const handle = setTimeout(() => {
      setAppliedFilters(filters);
    }, 250);
    return () => {
      clearTimeout(handle);
    };
  }, [filters]);

  useEffect(() => {
    // AbortController gives us an out-of-band "is this run stale?" flag whose
    // value isn't statically known to ESLint (unlike a plain `let cancelled`),
    // so the post-await guards don't trip no-unnecessary-condition.
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const q = query(
          collection(db, COLLECTIONS.auditLog),
          ...buildConstraints(appliedFilters),
          limit(PAGE_SIZE),
        );
        const snap = await getDocs(q);
        if (controller.signal.aborted) return;
        setEntries(snap.docs.map((d) => ({ ...(d.data() as AuditLog), id: d.id })));
        setCursor(snap.docs.at(-1) ?? null);
        setHasMore(snap.size === PAGE_SIZE);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load audit log');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [appliedFilters]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, COLLECTIONS.auditLog),
        ...buildConstraints(appliedFilters),
        startAfter(cursor),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      setEntries((prev) => [
        ...prev,
        ...snap.docs.map((d) => ({ ...(d.data() as AuditLog), id: d.id })),
      ]);
      setCursor(snap.docs.at(-1) ?? cursor);
      setHasMore(snap.size === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoading(false);
    }
  }, [cursor, appliedFilters]);

  const hasActiveFilters =
    filters.action !== '' ||
    filters.userEmail !== '' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== '' ||
    targetFilter !== '';

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setTargetFilter('');
  }

  const visibleEntries = useMemo(() => {
    const needle = targetFilter.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => e.target.toLowerCase().includes(needle));
  }, [entries, targetFilter]);

  function exportCsv() {
    const csv = toCsv(visibleEntries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const columns: ColumnDef<LogEntry>[] = useMemo(
    () => [
      {
        key: 'timestamp',
        header: 'Timestamp',
        headClassName: 'w-44',
        cellClassName: 'font-mono text-xs',
        cell: (e) => formatTimestamp(e.timestamp),
        mobile: { primary: true },
      },
      {
        key: 'user',
        header: 'User',
        headClassName: 'w-56',
        cellClassName: 'text-sm',
        cell: (e) => e.userEmail ?? <em>system</em>,
      },
      {
        key: 'action',
        header: 'Action',
        headClassName: 'w-44',
        cellClassName: 'font-mono text-xs',
        cell: (e) => e.action,
      },
      {
        key: 'target',
        header: 'Target',
        cellClassName: 'font-mono text-xs',
        cell: (e) => e.target,
      },
      {
        key: 'details',
        header: 'Details',
        headClassName: 'w-32',
        cell: (e) => <DetailsButton details={e.details} />,
      },
    ],
    [],
  );

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Audit Log']}
      title="Audit Log"
      subtitle="Append-only record of privileged actions (sign-ins, observation lifecycle, admin edits). Pruned daily by a scheduled function based on the retention setting in App Settings."
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      <div className="bg-muted/40 mb-4 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="grid gap-1.5">
          <Label htmlFor="audit-action">Action</Label>
          <select
            id="audit-action"
            className="border-input bg-background h-11 min-h-11 rounded-md border px-3 py-2 text-sm"
            value={filters.action}
            onChange={(e) => {
              setFilters((f) => ({ ...f, action: e.target.value }));
            }}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="audit-user-email">User email</Label>
          <Input
            id="audit-user-email"
            type="text"
            placeholder="user@orono.k12.mn.us"
            value={filters.userEmail}
            onChange={(e) => {
              setFilters((f) => ({ ...f, userEmail: e.target.value }));
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="audit-date-from">From date</Label>
          <Input
            id="audit-date-from"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => {
              setFilters((f) => ({ ...f, dateFrom: e.target.value }));
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="audit-date-to">To date</Label>
          <Input
            id="audit-date-to"
            type="date"
            value={filters.dateTo}
            onChange={(e) => {
              setFilters((f) => ({ ...f, dateTo: e.target.value }));
            }}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="audit-target">Target (loaded rows only)</Label>
          <Input
            id="audit-target"
            type="text"
            placeholder="observations/…"
            value={targetFilter}
            onChange={(e) => {
              setTargetFilter(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" aria-label="Clear all filters" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-label="Export visible entries as CSV"
          disabled={visibleEntries.length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </Button>
      </div>

      <AdminDataView
        columns={columns}
        rows={loading && entries.length === 0 ? null : visibleEntries}
        loading={loading && entries.length === 0}
        rowKey={(e) => e.id}
        empty="No audit log entries yet. Entries appear here as users sign in and admins make changes."
        skeletonRows={8}
      />

      <div className="mt-4 flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Showing {visibleEntries.length} entries
          {!hasMore && entries.length > 0 ? ' (end of log)' : ''}
        </p>
        <Button
          variant="outline"
          onClick={() => void loadMore()}
          disabled={!hasMore || loading || !cursor}
        >
          {loading ? 'Loading…' : hasMore ? 'Load 50 more' : 'No more entries'}
        </Button>
      </div>
    </PageHeader>
  );
}

function formatTimestamp(ts: AuditLog['timestamp']): string {
  const date = ts instanceof Timestamp ? ts.toDate() : ts;
  if (!(date instanceof Date)) return String(ts);
  return date.toLocaleString();
}

/** Serialize the visible entries to a CSV string. */
function toCsv(rows: LogEntry[]): string {
  const header = ['timestamp', 'userEmail', 'action', 'target', 'details'];
  const lines = rows.map((r) =>
    [
      formatTimestamp(r.timestamp),
      r.userEmail ?? 'system',
      r.action,
      r.target,
      JSON.stringify(r.details),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

/** Quote a CSV cell, escaping embedded quotes. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function DetailsButton({ details }: { details: AuditLog['details'] }) {
  const [open, setOpen] = useState(false);
  if (Object.keys(details).length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {open ? 'Hide' : 'View'}
      </Button>
      {open ? (
        <pre className="bg-muted mt-2 max-h-64 max-w-full overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
          {JSON.stringify(details, null, 2)}
        </pre>
      ) : null}
    </>
  );
}
