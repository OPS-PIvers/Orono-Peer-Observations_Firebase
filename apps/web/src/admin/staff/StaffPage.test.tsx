import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@ops/shared';

// Hoisted so the vi.mock factories below (which Vitest lifts to the top of
// the file) can reference them without hitting the TDZ. `staffState.rows`
// backs the getDocs mock so tests can change what a refetch returns.
const { mockGetDocs, mockSetDoc, staffState } = vi.hoisted(() => {
  const staffState = { rows: [] as (Staff & { id: string })[] };
  return {
    staffState,
    mockGetDocs: vi.fn(() =>
      Promise.resolve({
        docs: staffState.rows.map((r) => ({ id: r.id, data: () => r })),
      }),
    ),
    mockSetDoc: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ kind: 'collection', path }),
  query: (...args: unknown[]) => ({ kind: 'query', args }),
  getDocs: mockGetDocs,
  doc: (_db: unknown, collectionPath: string, id: string) => ({
    path: `${collectionPath}/${id}`,
  }),
  setDoc: mockSetDoc,
  deleteDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: () => 'server-timestamp',
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
  orderBy: (field: string) => ({ type: 'orderBy', field }),
  writeBatch: () => ({ set: () => undefined, commit: () => Promise.resolve() }),
}));

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

// The lookup collections (roles/buildings/modules) are small live listeners —
// stub them with static fixtures so these tests focus on the staff list's
// once-read cache behavior.
vi.mock('@/hooks/useFirestoreCollection', () => {
  const fixtures: Record<string, Record<string, unknown>[]> = {
    roles: [
      {
        id: 'teacher',
        roleId: 'teacher',
        displayName: 'Teacher',
        rubricId: 'teacher',
        isSpecialAccess: false,
        isActive: true,
      },
      {
        id: 'principal',
        roleId: 'principal',
        displayName: 'Principal',
        rubricId: 'principal',
        isSpecialAccess: false,
        isActive: true,
      },
    ],
    buildings: [{ id: 'oms', buildingId: 'oms', displayName: 'OMS', isActive: true }],
    modules: [],
  };
  return {
    useFirestoreCollection: (collectionPath: string) => ({
      data: fixtures[collectionPath] ?? [],
      loading: false,
      error: null,
    }),
  };
});

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: () => ({ data: null, loading: false, error: null }),
}));

import { StaffPage } from './StaffPage';

function adaRow(): Staff & { id: string } {
  return {
    id: 'ada@orono.k12.mn.us',
    email: 'ada@orono.k12.mn.us',
    name: 'Ada Lovelace',
    role: 'teacher',
    year: 1,
    buildings: ['OMS'],
    modules: [],
    moduleExclusions: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function graceRow(): Staff & { id: string } {
  return {
    ...adaRow(),
    id: 'grace@orono.k12.mn.us',
    email: 'grace@orono.k12.mn.us',
    name: 'Grace Hopper',
  };
}

beforeEach(() => {
  mockGetDocs.mockClear();
  mockSetDoc.mockClear();
  staffState.rows = [adaRow()];
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StaffPage />
    </QueryClientProvider>,
  );
}

describe('StaffPage staleness after edits', () => {
  it('reflects an inline pill edit immediately, without a refetch', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Lovelace');
    expect(mockGetDocs).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Role for Ada Lovelace' }));
    await user.click(await screen.findByRole('button', { name: 'Principal' }));

    // Write-through to Firestore…
    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: 'staff/ada@orono.k12.mn.us' },
      { role: 'principal', updatedAt: 'server-timestamp' },
      { merge: true },
    );
    // …and the cached row is patched so the pill renders the new value
    // without the manual Refresh.
    expect(screen.getByRole('button', { name: 'Role for Ada Lovelace' })).toHaveTextContent(
      'Principal',
    );
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('drops an archived row out of the default (active) view immediately', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('button', { name: 'Actions for Ada Lovelace' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive staff member' }));

    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: 'staff/ada@orono.k12.mn.us' },
      { isActive: false, updatedAt: 'server-timestamp' },
      { merge: true },
    );
    await waitFor(() => {
      expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    });
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('refetches after creating a staff member so the new row appears', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Lovelace');
    expect(mockGetDocs).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Add staff' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add staff' });
    await user.type(within(dialog).getByLabelText('Email'), 'grace@orono.k12.mn.us');
    await user.type(within(dialog).getByLabelText('Name'), 'Grace Hopper');
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'teacher');

    staffState.rows = [adaRow(), graceRow()];
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    expect(mockSetDoc).toHaveBeenCalledWith(
      { path: 'staff/grace@orono.k12.mn.us' },
      {
        email: 'grace@orono.k12.mn.us',
        name: 'Grace Hopper',
        role: 'teacher',
        year: 1,
        buildings: [],
        modules: [],
        moduleExclusions: [],
        summativeYear: false,
        isActive: true,
        hasAdminAccess: false,
        updatedAt: 'server-timestamp',
        createdAt: 'server-timestamp',
      },
      { merge: true },
    );
  });

  it('refetches after saving the edit dialog so the table shows the edit', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Ada Lovelace'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit staff' });
    const nameInput = within(dialog).getByLabelText('Name');
    expect(nameInput).toHaveValue('Ada Lovelace');
    await user.clear(nameInput);
    await user.type(nameInput, 'Ada K. Lovelace');

    staffState.rows = [{ ...adaRow(), name: 'Ada K. Lovelace' }];
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Ada K. Lovelace')).toBeInTheDocument();
    expect(mockGetDocs).toHaveBeenCalledTimes(2);
  });

  it('clears the selection and refetches after a bulk apply', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ada Lovelace');

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select row' }));
    await user.click(screen.getByRole('button', { name: 'Set year' }));

    const dialog = await screen.findByRole('dialog', { name: 'Set year' });
    await user.selectOptions(within(dialog).getByLabelText('Year'), '2');
    staffState.rows = [{ ...adaRow(), year: 2 }];
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 1' }));

    await waitFor(() => {
      expect(mockGetDocs).toHaveBeenCalledTimes(2);
    });
    // Selection cleared — the bulk-edit bar (with its Clear button) is gone.
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });
});
