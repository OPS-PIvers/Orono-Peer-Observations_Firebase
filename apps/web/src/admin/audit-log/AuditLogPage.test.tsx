/**
 * AuditLogPage — filter/export unit tests.
 *
 * These tests focus on the constraint-building and CSV-export logic
 * without hitting Firestore. The getDocs mock captures the query
 * constraints so assertions can verify that the right where() / orderBy()
 * calls are produced for a given filter state.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLog } from '@ops/shared';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { capturedConstraints, mockGetDocs, auditState } = vi.hoisted(() => {
  /** Each call to getDocs pushes the flat constraints array here. */
  const capturedConstraints: unknown[][] = [];
  const auditState = { rows: [] as (AuditLog & { id: string })[] };

  const mockGetDocs = vi.fn(
    (q: { kind: string; args: unknown[] }) =>
      new Promise<{
        docs: { id: string; data: () => AuditLog }[];
        size: number;
      }>((resolve) => {
        // The query built by the component looks like: query(base, ...constraints).
        // Our mock returns { kind: 'query', args: [base, c1, c2, ...] } from the
        // query() stub below — so args[0] is the collection ref, rest are constraints.
        const constraints = Array.isArray(q.args) ? q.args.slice(1) : [];
        capturedConstraints.push(constraints);
        const docs = auditState.rows.map((r) => ({ id: r.id, data: () => r }));
        resolve({ docs, size: docs.length });
      }),
  );

  return { capturedConstraints, mockGetDocs, auditState };
});

vi.mock('firebase/firestore', () => {
  // Timestamp must be a class (constructor function) because the production
  // code does `ts instanceof Timestamp`. The nanoseconds parameter is part of
  // the real Firestore Timestamp API but unused in this stub — store it so the
  // lint rule is satisfied.
  class FakeTimestamp {
    _seconds: number;
    _nanoseconds: number;
    constructor(seconds: number, nanoseconds: number) {
      this._seconds = seconds;
      this._nanoseconds = nanoseconds;
    }
    toDate(): Date {
      return new Date(this._seconds * 1000);
    }
    static fromDate(d: Date): FakeTimestamp {
      return new FakeTimestamp(Math.floor(d.getTime() / 1000), 0);
    }
  }
  return {
    Timestamp: FakeTimestamp,
    collection: (_db: unknown, path: string) => ({ kind: 'collection', path }),
    query: (...args: unknown[]) => ({ kind: 'query', args }),
    getDocs: mockGetDocs,
    limit: (n: number) => ({ type: 'limit', n }),
    orderBy: (field: string, dir: string) => ({ type: 'orderBy', field, dir }),
    startAfter: (doc: unknown) => ({ type: 'startAfter', doc }),
    where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
  };
});

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

// PageHeader is a layout wrapper — render a minimal pass-through stub.
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AuditLogPage } from './AuditLogPage';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AuditLog & { id: string }> = {}): AuditLog & { id: string } {
  return {
    id: 'entry-1',
    logId: 'entry-1',
    // AuditLog['timestamp'] is typed as Date (zod z.date()); Firestore returns
    // a Timestamp at runtime, but the type-safe fixture uses a plain Date.
    timestamp: new Date('2026-05-01T10:00:00Z'),
    userEmail: 'alice@orono.k12.mn.us',
    action: 'sign_in',
    target: 'staff/alice@orono.k12.mn.us',
    details: {},
    ipHash: null,
    ...overrides,
  };
}

function renderPage() {
  return render(<AuditLogPage />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  auditState.rows = [];
  capturedConstraints.length = 0;
  mockGetDocs.mockClear();
});

describe('initial load', () => {
  it('fires an unfiltered query on mount', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));

    const constraints = capturedConstraints[0] ?? [];
    const orderByCalls = constraints.filter((c) => (c as { type: string }).type === 'orderBy');
    const whereCalls = constraints.filter((c) => (c as { type: string }).type === 'where');
    expect(orderByCalls).toHaveLength(1);
    expect(whereCalls).toHaveLength(0);
  });

  it('shows empty-state when no entries are returned', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.queryByText(/No audit log entries yet/i)).toBeInTheDocument(),
    );
  });
});

describe('filter controls rendering', () => {
  it('renders action, user email, date-from, date-to, and target inputs', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());

    expect(screen.getByLabelText('Action')).toBeInTheDocument();
    expect(screen.getByLabelText('User email')).toBeInTheDocument();
    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
    expect(screen.getByLabelText('Target (loaded rows only)')).toBeInTheDocument();
  });

  it('action dropdown contains "All actions" and at least one action label', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());

    // Verify "All actions" option exists and there are other action options.
    expect(screen.getByRole('option', { name: 'All actions' })).toBeInTheDocument();
    // The action dropdown should have more than one option (All actions + at least one action).
    const allOptions = screen.getAllByRole('option');
    expect(allOptions.length).toBeGreaterThan(1);
  });
});

describe('action filter → query constraints', () => {
  it('adds a where(action ==) constraint when an action is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));
    capturedConstraints.length = 0;
    mockGetDocs.mockClear();

    const select = screen.getByLabelText('Action');
    await user.selectOptions(select, 'sign_in');

    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));
    const constraints = capturedConstraints[0] ?? [];
    const whereCall = constraints.find(
      (c) =>
        (c as { type: string; field: string }).type === 'where' &&
        (c as { field: string }).field === 'action',
    ) as { type: string; field: string; op: string; value: string } | undefined;
    expect(whereCall).toBeDefined();
    expect(whereCall?.value).toBe('sign_in');
  });

  it('removes the where(action) constraint when reset to "All actions"', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));

    const select = screen.getByLabelText('Action');
    await user.selectOptions(select, 'sign_in');
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(2));

    capturedConstraints.length = 0;
    mockGetDocs.mockClear();
    await user.selectOptions(select, '');
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));

    const constraints = capturedConstraints[0] ?? [];
    const whereCall = constraints.find(
      (c) => (c as { type: string; field: string }).type === 'where',
    );
    expect(whereCall).toBeUndefined();
  });
});

describe('userEmail filter → query constraints', () => {
  it('adds a where(userEmail ==) constraint after typing a complete email', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));
    capturedConstraints.length = 0;
    mockGetDocs.mockClear();

    const emailInput = screen.getByLabelText('User email');
    await user.type(emailInput, 'alice@orono.k12.mn.us');

    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());
    // Find the most recent call that has a userEmail where constraint.
    const lastConstraints = capturedConstraints.at(-1) ?? [];
    const whereCall = lastConstraints.find(
      (c) =>
        (c as { type: string; field: string }).type === 'where' &&
        (c as { field: string }).field === 'userEmail',
    ) as { value: string } | undefined;
    expect(whereCall).toBeDefined();
    expect(whereCall?.value).toBe('alice@orono.k12.mn.us');
  });
});

describe('date range filter → query constraints', () => {
  it('adds timestamp >= constraint for dateFrom', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));
    capturedConstraints.length = 0;
    mockGetDocs.mockClear();

    const fromInput = screen.getByLabelText('From date');
    // fireEvent.change triggers React's synthetic onChange handler.
    fireEvent.change(fromInput, { target: { value: '2026-05-01' } });

    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());
    const lastConstraints = capturedConstraints.at(-1) ?? [];
    const tsGteCall = lastConstraints.find(
      (c) =>
        (c as { type: string; field: string; op: string }).type === 'where' &&
        (c as { field: string }).field === 'timestamp' &&
        (c as { op: string }).op === '>=',
    );
    expect(tsGteCall).toBeDefined();
  });

  it('adds timestamp <= constraint for dateTo', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));
    capturedConstraints.length = 0;
    mockGetDocs.mockClear();

    const toInput = screen.getByLabelText('To date');
    fireEvent.change(toInput, { target: { value: '2026-05-31' } });

    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());
    const lastConstraints = capturedConstraints.at(-1) ?? [];
    const tsLteCall = lastConstraints.find(
      (c) =>
        (c as { type: string; field: string; op: string }).type === 'where' &&
        (c as { field: string }).field === 'timestamp' &&
        (c as { op: string }).op === '<=',
    );
    expect(tsLteCall).toBeDefined();
  });
});

describe('target search — client-side filter', () => {
  beforeEach(() => {
    auditState.rows = [
      makeEntry({ id: 'e1', target: 'observations/abc123' }),
      makeEntry({ id: 'e2', target: 'staff/bob@orono.k12.mn.us' }),
    ];
  });

  it('narrows visible rows without triggering a new Firestore query', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));

    // Both rows should be visible initially.
    await waitFor(() =>
      expect(screen.getAllByText(/observations\/abc123|staff\/bob/i).length).toBeGreaterThan(0),
    );

    const callsBefore = mockGetDocs.mock.calls.length;
    const targetInput = screen.getByLabelText('Target (loaded rows only)');
    await user.type(targetInput, 'observations');

    // Firestore should NOT be called again — this is a client-side filter.
    expect(mockGetDocs.mock.calls.length).toBe(callsBefore);

    // The bob row should be hidden; the observations row should remain.
    await waitFor(() => {
      expect(screen.queryByText('staff/bob@orono.k12.mn.us')).not.toBeInTheDocument();
    });
  });
});

describe('clear filters button', () => {
  it('is hidden when no filters are active', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());
    expect(screen.queryByLabelText('Clear all filters')).not.toBeInTheDocument();
  });

  it('appears when a filter is set and resets state on click', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));

    const select = screen.getByLabelText('Action');
    await user.selectOptions(select, 'sign_in');
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(2));

    const clearBtn = screen.getByLabelText('Clear all filters');
    expect(clearBtn).toBeInTheDocument();

    capturedConstraints.length = 0;
    mockGetDocs.mockClear();
    await user.click(clearBtn);

    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(1));
    const constraints = capturedConstraints[0] ?? [];
    const whereCalls = constraints.filter((c) => (c as { type: string }).type === 'where');
    expect(whereCalls).toHaveLength(0);
    expect(screen.queryByLabelText('Clear all filters')).not.toBeInTheDocument();
  });
});

describe('export CSV button', () => {
  it('is disabled when no rows are loaded', async () => {
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());
    const btn = screen.getByLabelText('Export visible entries as CSV');
    expect(btn).toBeDisabled();
  });

  it('is enabled when rows are present', async () => {
    auditState.rows = [makeEntry()];
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());
    await waitFor(() => {
      const btn = screen.getByLabelText('Export visible entries as CSV');
      expect(btn).not.toBeDisabled();
    });
  });

  it('triggers a CSV download on click (URL.createObjectURL called)', async () => {
    auditState.rows = [makeEntry()];
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window, 'URL', {
      value: { createObjectURL, revokeObjectURL },
      writable: true,
    });
    // Prevent actual anchor click navigation in jsdom.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalled());

    const btn = await screen.findByLabelText('Export visible entries as CSV');
    await user.click(btn);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
