/**
 * TranscriptionJobsPage — rendering and filter unit tests.
 *
 * These tests verify that the page correctly renders job rows, applies the
 * status filter to the Firestore query, shows the failure banner, and
 * surfaces the re-queue button only for Failed jobs — all without hitting
 * a real Firestore instance.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptionJob } from '@ops/shared';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { capturedConstraints, mockGetDocs, jobState, mockCallable } = vi.hoisted(() => {
  const capturedConstraints: unknown[][] = [];
  const jobState = { rows: [] as (TranscriptionJob & { id: string })[] };

  const mockGetDocs = vi.fn(
    (q: { kind: string; args: unknown[] }) =>
      new Promise<{
        docs: { id: string; data: () => TranscriptionJob }[];
        size: number;
      }>((resolve) => {
        const constraints = Array.isArray(q.args) ? q.args.slice(1) : [];
        capturedConstraints.push(constraints);
        const docs = jobState.rows.map((r) => ({ id: r.id, data: () => r }));
        resolve({ docs, size: docs.length });
      }),
  );

  const mockCallable = vi.fn(() => Promise.resolve({ data: { jobId: 'new-job-1' } }));

  return { capturedConstraints, mockGetDocs, jobState, mockCallable };
});

vi.mock('firebase/firestore', () => ({
  Timestamp: class FakeTimestamp {
    _seconds: number;
    _nanoseconds: number;
    constructor(seconds: number, nanoseconds: number) {
      this._seconds = seconds;
      this._nanoseconds = nanoseconds;
    }
    toDate(): Date {
      return new Date(this._seconds * 1000);
    }
    static fromDate(d: Date): { _seconds: number; _nanoseconds: number } {
      return { _seconds: Math.floor(d.getTime() / 1000), _nanoseconds: 0 };
    }
  },
  collection: (_db: unknown, path: string) => ({ kind: 'collection', path }),
  query: (...args: unknown[]) => ({ kind: 'query', args }),
  getDocs: mockGetDocs,
  limit: (n: number) => ({ type: 'limit', n }),
  orderBy: (field: string, dir: string) => ({ type: 'orderBy', field, dir }),
  startAfter: (doc: unknown) => ({ type: 'startAfter', doc }),
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Radix Popover requires Portal which doesn't exist in jsdom — stub it.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { TranscriptionJobsPage } from './TranscriptionJobsPage';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(
  overrides: Partial<TranscriptionJob & { id: string }> = {},
): TranscriptionJob & { id: string } {
  return {
    id: 'job-1',
    jobId: 'job-1',
    observationId: 'obs-abc123',
    audioDriveFileId: 'drive-file-1',
    requestedBy: 'pe@orono.k12.mn.us',
    status: 'Completed',
    startedAt: new Date('2026-05-01T10:00:00Z'),
    completedAt: new Date('2026-05-01T10:01:30Z'),
    error: null,
    transcriptPreview: 'Hello this is a test transcript.',
    geminiFileUri: null,
    createdAt: new Date('2026-05-01T10:00:00Z'),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TranscriptionJobsPage />
    </MemoryRouter>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jobState.rows = [];
  capturedConstraints.length = 0;
  mockGetDocs.mockClear();
  mockCallable.mockClear();
});

describe('initial load', () => {
  it('fires an unfiltered query on mount (orderBy only, no status where)', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));

    const constraints = capturedConstraints[0] ?? [];
    const orderByCalls = constraints.filter((c) => (c as { type: string }).type === 'orderBy');
    const whereCalls = constraints.filter((c) => (c as { type: string }).type === 'where');
    expect(orderByCalls).toHaveLength(1);
    expect(whereCalls).toHaveLength(0);
  });

  it('shows empty-state when no jobs are returned', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText(/No transcription jobs found/i)).toBeInTheDocument(),
    );
  });

  it('renders job rows when jobs are present', async () => {
    jobState.rows = [makeJob()];
    renderPage();
    await waitFor(() => expect(screen.queryByText('pe@orono.k12.mn.us')).toBeInTheDocument());
  });
});

describe('status filter chips', () => {
  it('renders All + four status chips', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Running' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Failed' })).toBeInTheDocument();
  });

  it('adds a where(status ==) constraint when a status chip is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));
    capturedConstraints.length = 0;
    mockGetDocs.mockClear();

    await user.click(screen.getByRole('button', { name: 'Failed' }));

    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));
    const constraints = capturedConstraints[0] ?? [];
    const whereCall = constraints.find(
      (c) =>
        (c as { type: string; field: string }).type === 'where' &&
        (c as { field: string }).field === 'status',
    ) as { value: string } | undefined;
    expect(whereCall).toBeDefined();
    expect(whereCall?.value).toBe('Failed');
  });

  it('removes the where(status) constraint when "All" chip is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Failed' }));
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(2));

    capturedConstraints.length = 0;
    mockGetDocs.mockClear();
    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));

    const constraints = capturedConstraints[0] ?? [];
    const whereCalls = constraints.filter((c) => (c as { type: string }).type === 'where');
    expect(whereCalls).toHaveLength(0);
  });
});

describe('failure banner', () => {
  it('shows the failure banner when failed jobs are present and no status filter is active', async () => {
    jobState.rows = [makeJob({ id: 'j1', status: 'Failed', error: 'API key expired' })];
    renderPage();
    await waitFor(() => expect(screen.queryByText(/failed job/i)).toBeInTheDocument());
  });

  it('does not show the failure banner when there are no failed jobs', async () => {
    jobState.rows = [makeJob({ id: 'j1', status: 'Completed' })];
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/failed job/i)).not.toBeInTheDocument());
  });
});

describe('status badge', () => {
  it('renders a Completed badge for a Completed job', async () => {
    jobState.rows = [makeJob({ id: 'j1', status: 'Completed' })];
    renderPage();
    await waitFor(() => expect(screen.queryByText('Completed')).toBeInTheDocument());
  });

  it('renders a Failed badge for a Failed job', async () => {
    jobState.rows = [makeJob({ id: 'j1', status: 'Failed', error: 'timeout' })];
    renderPage();
    await waitFor(() => expect(screen.queryByText('Failed')).toBeInTheDocument());
  });
});

describe('re-queue action', () => {
  it('shows Re-queue button only for Failed jobs', async () => {
    jobState.rows = [
      makeJob({ id: 'j1', status: 'Completed' }),
      makeJob({ id: 'j2', status: 'Failed', error: 'API error' }),
    ];
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());
    await waitFor(() => {
      const requeueBtns = screen.queryAllByRole('button', {
        name: /re-queue failed transcription job/i,
      });
      expect(requeueBtns).toHaveLength(1);
    });
  });

  it('calls requestTranscription callable with the correct arguments on re-queue', async () => {
    const user = userEvent.setup();
    jobState.rows = [
      makeJob({
        id: 'j1',
        status: 'Failed',
        observationId: 'obs-abc123',
        audioDriveFileId: 'drive-file-1',
      }),
    ];
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());

    const btn = await screen.findByRole('button', { name: /re-queue failed transcription job/i });
    await user.click(btn);

    await waitFor(() => expect(mockCallable).toHaveBeenCalledTimes(1));
    expect(mockCallable).toHaveBeenCalledWith({
      observationId: 'obs-abc123',
      audioFileId: 'drive-file-1',
    });
  });

  it('shows Queued text after a successful re-queue', async () => {
    const user = userEvent.setup();
    jobState.rows = [makeJob({ id: 'j1', status: 'Failed', error: 'expired' })];
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());

    const btn = await screen.findByRole('button', { name: /re-queue failed transcription job/i });
    await user.click(btn);

    await waitFor(() => expect(screen.queryByText('Queued')).toBeInTheDocument());
  });
});
