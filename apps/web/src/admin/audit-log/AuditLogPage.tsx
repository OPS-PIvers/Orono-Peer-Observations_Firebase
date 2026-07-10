import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Download, MailWarning } from 'lucide-react';
import { AUDIT_ACTIONS, COLLECTIONS, type AuditLog } from '@ops/shared';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { AdminDataView, type ColumnDef } from '@/admin/_shared/AdminDataView';
import { csvSerializeRow, downloadTextFile } from '@/admin/staff/staffCsv';

const PAGE_SIZE = 50;
const FAILURES_PREVIEW_SIZE = 5;
/** Page size used while paging through every filtered entry for CSV
 *  export — larger than the on-screen page since there's no user waiting
 *  between pages, just a chain of getDocs calls. */
const EXPORT_PAGE_SIZE = 500;
/** Hard cap on exported rows so a filter that happens to match most of a
 *  year's retained log can't page forever. */
const EXPORT_MAX_ROWS = 20000;

const AUDIT_CSV_COLUMNS = ['timestamp', 'userEmail', 'action', 'target', 'details'] as const;

interface LogEntry extends AuditLog {
  id: string;
}

/** Raw-string audit actions the scheduling/calendar Cloud Functions write
 *  outside the AUDIT_ACTIONS enum (grep `action: '` under apps/functions/src
 *  and keep this list in sync) — without them the dropdown silently can't
 *  select most scheduling/calendar entries. */
const FUNCTION_AUDIT_ACTIONS = [
  'calendar.connect',
  'calendar.disconnect',
  'calendar.eventCreateFailed',
  'calendar.eventSkipped',
  'calendar.eventUpdated',
  'observation.finalize',
  'observationSlot.book',
  'observationSlot.cancel',
  'observationSlot.reschedule',
  'observationWindow.assignFromPreference',
  'observationWindow.cancel',
  'observationWindow.create',
  'observationWindow.expire',
  'observationWindow.scheduleChangeWarning',
  'observationWindow.submitDayPreference',
  'observationWindow.update',
] as const;

/** Filter options for the action dropdown — "All actions" plus every
 *  AUDIT_ACTIONS value and every known function-written raw action,
 *  sorted for a stable, scannable list. */
const ACTION_FILTER_OPTIONS: { label: string; value: string }[] = [
  { label: 'All actions', value: 'all' },
  ...Array.from(new Set<string>([...Object.values(AUDIT_ACTIONS), ...FUNCTION_AUDIT_ACTIONS]))
    .sort()
    .map((value) => ({ label: value, value })),
];

/** Filters that turn into real Firestore `where` constraints. `dateFrom`/
 *  `dateTo` are `yyyy-mm-dd` strings straight out of `<input type="date">`;
 *  `dateTo` is treated as inclusive of the whole day. */
interface AuditFilters {
  /** An AUDIT_ACTIONS value, a FUNCTION_AUDIT_ACTIONS value, or 'all'. */
  action: string;
  userEmail: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: AuditFilters = { action: 'all', userEmail: '', dateFrom: '', dateTo: '' };

function startOfDay(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00`);
  return d;
}

function endOfDay(dateStr: string): Date {
  const d = new Date(`${dateStr}T23:59:59.999`);
  return d;
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [filterAction, setFilterAction] = useState<string>('all');

  // userEmail is an exact-match filter, but we don't want to re-query on
  // every keystroke, so the input's raw text is debounced into the
  // committed filter that actually drives the query (mirrors
  // ModuleSectionEditor's debounceRef pattern).
  const [userEmailInput, setUserEmailInput] = useState('');
  const [filterUserEmail, setFilterUserEmail] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Independent small query for the "Email delivery failures" card — always
  // shows the most recent failures regardless of the main table's filter,
  // so a failure surfaces even if an admin is looking at unrelated entries.
  const [failures, setFailures] = useState<LogEntry[] | null>(null);
  const [failuresError, setFailuresError] = useState<string | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilterUserEmail(userEmailInput.trim().toLowerCase());
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [userEmailInput]);

  const filters = useMemo<AuditFilters>(
    () => ({ action: filterAction, userEmail: filterUserEmail, dateFrom, dateTo }),
    [filterAction, filterUserEmail, dateFrom, dateTo],
  );

  const buildQuery = useCallback(
    (f: AuditFilters, pageSize: number, after?: QueryDocumentSnapshot) => {
      const constraints: QueryConstraint[] = [];
      if (f.userEmail) constraints.push(where('userEmail', '==', f.userEmail));
      if (f.action !== 'all') constraints.push(where('action', '==', f.action));
      if (f.dateFrom)
        constraints.push(where('timestamp', '>=', Timestamp.fromDate(startOfDay(f.dateFrom))));
      if (f.dateTo)
        constraints.push(where('timestamp', '<=', Timestamp.fromDate(endOfDay(f.dateTo))));
      constraints.push(orderBy('timestamp', 'desc'));
      if (after) constraints.push(startAfter(after));
      constraints.push(limit(pageSize));
      return query(collection(db, COLLECTIONS.auditLog), ...constraints);
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDocs(buildQuery(filters, PAGE_SIZE));
        setEntries(snap.docs.map((d) => ({ ...(d.data() as AuditLog), id: d.id })));
        setCursor(snap.docs.at(-1) ?? null);
        setHasMore(snap.size === PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audit log');
      } finally {
        setLoading(false);
      }
    })();
  }, [filters, buildQuery]);

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, COLLECTIONS.auditLog),
            where('action', '==', AUDIT_ACTIONS.emailDeliveryFailed),
            orderBy('timestamp', 'desc'),
            limit(FAILURES_PREVIEW_SIZE),
          ),
        );
        setFailures(snap.docs.map((d) => ({ ...(d.data() as AuditLog), id: d.id })));
      } catch (err) {
        setFailuresError(err instanceof Error ? err.message : 'Failed to load email failures');
      }
    })();
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(buildQuery(filters, PAGE_SIZE, cursor));
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
  }, [cursor, filters, buildQuery]);

  const hasActiveFilters =
    filters.action !== 'all' ||
    filters.userEmail !== '' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== '';

  const clearFilters = useCallback(() => {
    setFilterAction(EMPTY_FILTERS.action);
    setUserEmailInput('');
    setFilterUserEmail('');
    setDateFrom('');
    setDateTo('');
  }, []);

  /** Download the currently-filtered entries as CSV. Pages through Firestore
   *  with `buildQuery` (same constraints as the on-screen table) at
   *  EXPORT_PAGE_SIZE per request until either the log runs out or
   *  EXPORT_MAX_ROWS is hit, then hand-serializes CSV — no dependency,
   *  matching StaffPage's export convention. */
  const exportCsv = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const rows: LogEntry[] = [];
      let after: QueryDocumentSnapshot | undefined;
      for (;;) {
        const snap = await getDocs(buildQuery(filters, EXPORT_PAGE_SIZE, after));
        rows.push(...snap.docs.map((d) => ({ ...(d.data() as AuditLog), id: d.id })));
        after = snap.docs.at(-1);
        if (snap.size < EXPORT_PAGE_SIZE || !after || rows.length >= EXPORT_MAX_ROWS) break;
      }
      const lines = [csvSerializeRow(AUDIT_CSV_COLUMNS)];
      for (const e of rows.slice(0, EXPORT_MAX_ROWS)) {
        lines.push(
          csvSerializeRow([
            formatTimestamp(e.timestamp),
            e.userEmail ?? '',
            e.action,
            e.target,
            JSON.stringify(e.details),
          ]),
        );
      }
      const date = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        lines.join('\r\n') + '\r\n',
        `audit-log-${date}.csv`,
        'text/csv;charset=utf-8',
      );
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to export audit log');
    } finally {
      setExporting(false);
    }
  }, [filters, buildQuery]);

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
        cell: (e) =>
          e.action === AUDIT_ACTIONS.emailDeliveryFailed ? (
            <Badge tone="warning">{e.action}</Badge>
          ) : (
            e.action
          ),
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

      <EmailFailuresCard
        failures={failures}
        error={failuresError}
        onViewAll={() => setFilterAction(AUDIT_ACTIONS.emailDeliveryFailed)}
      />

      {exportError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          {exportError}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="audit-action-filter">Action</Label>
          <select
            id="audit-action-filter"
            className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
          >
            {ACTION_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="audit-user-filter">User email</Label>
          <Input
            id="audit-user-filter"
            type="email"
            placeholder="name@orono.k12.mn.us"
            className="w-56"
            value={userEmailInput}
            onChange={(e) => setUserEmailInput(e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="audit-date-from">From</Label>
          <Input
            id="audit-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="audit-date-to">To</Label>
          <Input
            id="audit-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        {hasActiveFilters ? (
          <Button variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}

        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => void exportCsv()}
          disabled={exporting}
        >
          <Download className="size-4" aria-hidden="true" />
          {exporting ? 'Exporting…' : 'Download CSV'}
        </Button>
      </div>

      <AdminDataView
        columns={columns}
        rows={loading && entries.length === 0 ? null : entries}
        loading={loading && entries.length === 0}
        rowKey={(e) => e.id}
        empty={
          hasActiveFilters
            ? 'No entries match these filters.'
            : 'No audit log entries yet. Entries appear here as users sign in and admins make changes.'
        }
        skeletonRows={8}
      />

      <div className="mt-4 flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Showing {entries.length} entries{!hasMore && entries.length > 0 ? ' (end of log)' : ''}
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

/**
 * Small admin-visible surface for finding #15 ("email delivery visibility"):
 * the most recent `email_delivery_failed` entries written by onMailWritten
 * (apps/functions/src/email/onMailWritten.ts) when the Trigger Email
 * extension reports a bounce/block/SMTP error back onto a /mail doc. This
 * is the only place a failed send is distinguishable from a queued one —
 * the `email_sent` entry alone doesn't mean delivery succeeded.
 */
function EmailFailuresCard({
  failures,
  error,
  onViewAll,
}: {
  failures: LogEntry[] | null;
  error: string | null;
  onViewAll: () => void;
}) {
  if (error) {
    return (
      <Card className="mb-4">
        <CardContent className="text-ops-red-dark p-4 text-sm">
          Failed to load email delivery failures: {error}
        </CardContent>
      </Card>
    );
  }

  // Still loading or nothing to show — don't take up space with an empty card.
  if (!failures || failures.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <MailWarning className="text-ops-red-dark size-4" aria-hidden="true" />
          Email delivery failures
        </CardTitle>
        <Button variant="outline" size="sm" onClick={onViewAll}>
          View all
        </Button>
      </CardHeader>
      <CardContent className="pt-3">
        <ul className="divide-border divide-y text-sm">
          {failures.map((f) => {
            const to = Array.isArray(f.details['to']) ? (f.details['to'] as string[]) : [];
            const subject = typeof f.details['subject'] === 'string' ? f.details['subject'] : '';
            const errMsg = typeof f.details['error'] === 'string' ? f.details['error'] : null;
            return (
              <li key={f.id} className="flex flex-col gap-0.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{subject || '(no subject)'}</span>
                  <span className="text-muted-foreground text-xs">to {to.join(', ') || '—'}</span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {formatTimestamp(f.timestamp)}
                  </span>
                </div>
                {errMsg ? (
                  <span className="text-ops-red-dark font-mono text-xs">{errMsg}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
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
