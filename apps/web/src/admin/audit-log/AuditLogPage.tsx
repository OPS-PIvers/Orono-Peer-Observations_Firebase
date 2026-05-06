import { useCallback, useEffect, useState } from 'react';
import {
  type QueryDocumentSnapshot,
  Timestamp,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
} from 'firebase/firestore';
import { COLLECTIONS, type AuditLog } from '@ops/shared';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 50;

interface LogEntry extends AuditLog {
  id: string;
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const q = query(
          collection(db, COLLECTIONS.auditLog),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE),
        );
        const snap = await getDocs(q);
        setEntries(snap.docs.map((d) => ({ ...(d.data() as AuditLog), id: d.id })));
        setCursor(snap.docs.at(-1) ?? null);
        setHasMore(snap.size === PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load audit log');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const q = query(
        collection(db, COLLECTIONS.auditLog),
        orderBy('timestamp', 'desc'),
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
  }, [cursor]);

  return (
    <PageHeader
      title="Audit Log"
      subtitle="Append-only record of privileged actions (sign-ins, observation lifecycle, admin edits). Pruned daily by a scheduled function based on the retention setting in App Settings."
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      <div className="border-border bg-background overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Timestamp</TableHead>
              <TableHead className="w-56">User</TableHead>
              <TableHead className="w-44">Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="w-32">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && entries.length === 0 ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`skeleton-${String(i)}`}>
                  <TableCell>
                    {i === 0 ? (
                      <span className="sr-only" role="status" aria-live="polite">
                        Loading audit log…
                      </span>
                    ) : null}
                    <Skeleton className="h-4 w-36" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-44" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-56" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-7 w-20" />
                  </TableCell>
                </TableRow>
              ))
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                  No audit log entries yet. Entries appear here as users sign in and admins make
                  changes.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">
                    {formatTimestamp(e.timestamp)}
                  </TableCell>
                  <TableCell className="text-sm">{e.userEmail ?? <em>system</em>}</TableCell>
                  <TableCell className="font-mono text-xs">{e.action}</TableCell>
                  <TableCell className="font-mono text-xs">{e.target}</TableCell>
                  <TableCell>
                    <DetailsButton details={e.details} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
  // Firestore Timestamps come through as the SDK Timestamp class; Dates
  // are also possible if a Cloud Function used Date.now() before Firestore
  // serialized. Handle both.
  const date = ts instanceof Timestamp ? ts.toDate() : ts;
  if (!(date instanceof Date)) return String(ts);
  return date.toLocaleString();
}

function DetailsButton({ details }: { details: AuditLog['details'] }) {
  const [open, setOpen] = useState(false);
  if (Object.keys(details).length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'View'}
      </Button>
      {open ? (
        <pre className="bg-muted absolute right-0 z-10 mt-1 max-h-64 max-w-md overflow-auto rounded-md p-3 text-xs">
          {JSON.stringify(details, null, 2)}
        </pre>
      ) : null}
    </>
  );
}
