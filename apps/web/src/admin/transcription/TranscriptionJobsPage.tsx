import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { httpsCallable } from 'firebase/functions';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { COLLECTIONS, type TranscriptionJob, type TranscriptionStatus } from '@ops/shared';
import { db, functions } from '@/lib/firebase';
import { Badge } from '@/components/ui/badge';
import type { BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PageHeader } from '@/components/PageHeader';
import { AdminDataView, type ColumnDef } from '@/admin/_shared/AdminDataView';

const PAGE_SIZE = 100;

type StatusFilter = TranscriptionStatus | '';

const STATUS_OPTIONS: TranscriptionStatus[] = ['Pending', 'Running', 'Completed', 'Failed'];

const STATUS_TONE: Record<TranscriptionStatus, BadgeTone> = {
  Pending: 'neutral',
  Running: 'info',
  Completed: 'active',
  Failed: 'warning',
};

interface JobEntry extends TranscriptionJob {
  id: string;
}

const reQueueFn = httpsCallable<
  { observationId: string; audioFileId: string },
  { jobId: string | null }
>(functions, 'requestTranscription');

export function TranscriptionJobsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Requeue state: map of jobId → 'loading' | 'done' | 'error'
  const [requeueState, setRequeueState] = useState<Record<string, 'loading' | 'done' | 'error'>>(
    {},
  );

  const buildQuery = useCallback(
    (after?: QueryDocumentSnapshot) => {
      const col = collection(db, COLLECTIONS.transcriptionJobs);
      const constraints: QueryConstraint[] = [];
      if (statusFilter) constraints.push(where('status', '==', statusFilter));
      constraints.push(orderBy('createdAt', 'desc'));
      constraints.push(limit(PAGE_SIZE));
      if (after) constraints.push(startAfter(after));
      return query(col, ...constraints);
    },
    [statusFilter],
  );

  const load = useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(buildQuery());
      if (controller.signal.aborted) return;
      setJobs(snap.docs.map((d) => ({ ...(d.data() as TranscriptionJob), id: d.id })));
      setCursor(snap.docs.at(-1) ?? null);
      setHasMore(snap.size === PAGE_SIZE);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'Failed to load transcription jobs');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
    return () => {
      controller.abort();
    };
  }, [buildQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(buildQuery(cursor));
      setJobs((prev) => [
        ...prev,
        ...snap.docs.map((d) => ({ ...(d.data() as TranscriptionJob), id: d.id })),
      ]);
      setCursor(snap.docs.at(-1) ?? cursor);
      setHasMore(snap.size === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoading(false);
    }
  }, [cursor, buildQuery]);

  const handleRequeue = useCallback(async (job: JobEntry) => {
    setRequeueState((s) => ({ ...s, [job.id]: 'loading' }));
    try {
      await reQueueFn({ observationId: job.observationId, audioFileId: job.audioDriveFileId });
      setRequeueState((s) => ({ ...s, [job.id]: 'done' }));
    } catch {
      setRequeueState((s) => ({ ...s, [job.id]: 'error' }));
    }
  }, []);

  const failedCount = useMemo(() => jobs.filter((j) => j.status === 'Failed').length, [jobs]);

  const columns: ColumnDef<JobEntry>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: 'Requested',
        headClassName: 'w-40',
        cellClassName: 'font-mono text-xs',
        cell: (j) => formatTimestamp(j.createdAt),
        mobile: { primary: true },
      },
      {
        key: 'requestedBy',
        header: 'Requester',
        headClassName: 'w-52',
        cellClassName: 'text-sm',
        cell: (j) => j.requestedBy,
      },
      {
        key: 'observationId',
        header: 'Observation',
        headClassName: 'w-40',
        cellClassName: 'font-mono text-xs',
        cell: (j) => (
          <Link
            to={`/observations/${j.observationId}`}
            className="text-ops-blue-dark hover:underline"
          >
            {j.observationId.slice(0, 8)}…
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        headClassName: 'w-28',
        cell: (j) => <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>,
      },
      {
        key: 'duration',
        header: 'Duration',
        headClassName: 'w-24',
        cellClassName: 'text-xs',
        cell: (j) => formatDuration(j.startedAt, j.completedAt),
      },
      {
        key: 'error',
        header: 'Error',
        cell: (j) =>
          j.error ? (
            <span className="text-ops-red-dark flex items-center gap-1 text-xs">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="line-clamp-2">{j.error}</span>
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          ),
      },
      {
        key: 'preview',
        header: 'Preview',
        headClassName: 'w-28',
        cell: (j) => <PreviewButton preview={j.transcriptPreview} />,
      },
      {
        key: 'actions',
        header: '',
        headClassName: 'w-24',
        cell: (j) =>
          j.status === 'Failed' ? (
            <RequeueButton state={requeueState[j.id]} onRequeue={() => void handleRequeue(j)} />
          ) : (
            <span />
          ),
      },
    ],
    [handleRequeue, requeueState],
  );

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Transcription Jobs']}
      title="Transcription Jobs"
      subtitle="Recent Gemini audio transcription jobs. Failed jobs indicate a problem with the configured model or API key."
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      {failedCount > 0 && statusFilter === '' ? (
        <div className="bg-ops-red-lighter text-ops-red-dark mb-4 flex items-center gap-2 rounded-md border border-orange-200 px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {failedCount} failed job{failedCount > 1 ? 's' : ''} in this page — check the Gemini
            model and API key in{' '}
            <Link to="/admin/settings" className="underline">
              Settings
            </Link>
            .
          </span>
        </div>
      ) : null}

      {/* Status filter chips */}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by job status">
        <button
          type="button"
          onClick={() => {
            setStatusFilter('');
          }}
          className={statusChipClass(statusFilter === '')}
          aria-pressed={statusFilter === ''}
        >
          All
        </button>
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatusFilter(s);
            }}
            className={statusChipClass(statusFilter === s)}
            aria-pressed={statusFilter === s}
          >
            {s}
          </button>
        ))}
      </div>

      <AdminDataView
        columns={columns}
        rows={loading && jobs.length === 0 ? null : jobs}
        loading={loading && jobs.length === 0}
        rowKey={(j) => j.id}
        empty="No transcription jobs found. Jobs appear here when an observer requests audio transcription."
        skeletonRows={8}
      />

      <div className="mt-4 flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Showing {jobs.length} job{jobs.length !== 1 ? 's' : ''}
          {!hasMore && jobs.length > 0 ? ' (end of results)' : ''}
        </p>
        <Button
          variant="outline"
          onClick={() => void loadMore()}
          disabled={!hasMore || loading || !cursor}
        >
          {loading ? 'Loading…' : hasMore ? `Load ${String(PAGE_SIZE)} more` : 'No more jobs'}
        </Button>
      </div>
    </PageHeader>
  );
}

// ── Helper components ──────────────────────────────────────────────────────────

function PreviewButton({ preview }: { preview: string | null }) {
  if (!preview) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="View transcript preview">
          Preview
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="text-xs leading-relaxed whitespace-pre-wrap">{preview}</p>
      </PopoverContent>
    </Popover>
  );
}

interface RequeueButtonProps {
  state: 'loading' | 'done' | 'error' | undefined;
  onRequeue: () => void;
}

function RequeueButton({ state, onRequeue }: RequeueButtonProps) {
  if (state === 'done') {
    return <span className="text-xs text-green-700">Queued</span>;
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={state === 'loading'}
      aria-label="Re-queue failed transcription job"
      onClick={onRequeue}
      className={state === 'error' ? 'border-destructive text-destructive' : ''}
    >
      <RefreshCw
        className={`mr-1 h-3.5 w-3.5 ${state === 'loading' ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      {state === 'error' ? 'Retry' : 'Re-queue'}
    </Button>
  );
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function statusChipClass(active: boolean): string {
  return [
    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
    active
      ? 'border-ops-blue-dark bg-ops-blue-dark text-white'
      : 'border-border bg-background text-muted-foreground hover:border-ops-blue-dark hover:text-ops-blue-dark',
  ].join(' ');
}

function toDate(ts: Date): Date {
  // At runtime Firestore may return a Timestamp object even though the Zod
  // schema types it as Date. Use instanceof so the conversion is safe.
  if (ts instanceof Timestamp) return ts.toDate();
  return ts;
}

function formatTimestamp(ts: TranscriptionJob['createdAt']): string {
  const date = toDate(ts);
  if (!(date instanceof Date)) return String(ts);
  return date.toLocaleString();
}

function formatDuration(
  startedAt: TranscriptionJob['startedAt'],
  completedAt: TranscriptionJob['completedAt'],
): string {
  if (!startedAt || !completedAt) return '—';
  const start = toDate(startedAt);
  const end = toDate(completedAt);
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return '—';
  const secs = Math.round(diffMs / 1000);
  if (secs < 60) return `${String(secs)}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${String(mins)}m ${String(rem)}s`;
}
