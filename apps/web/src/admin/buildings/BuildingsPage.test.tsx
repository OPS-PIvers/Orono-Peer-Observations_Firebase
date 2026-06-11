import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Building, Staff } from '@ops/shared';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock() factories use them.
// ---------------------------------------------------------------------------
const {
  mockSetDoc,
  mockDeleteDoc,
  mockGetDocs,
  mockBatchSet,
  mockBatchCommit,
  buildingsState,
  staffState,
} = vi.hoisted(() => {
  const buildingsState = {
    rows: [] as (Building & { id: string })[],
  };
  const staffState = {
    rows: [] as (Staff & { id: string })[],
  };
  return {
    buildingsState,
    staffState,
    mockSetDoc: vi.fn(() => Promise.resolve()),
    mockDeleteDoc: vi.fn(() => Promise.resolve()),
    mockGetDocs: vi.fn(() =>
      Promise.resolve({
        docs: staffState.rows.map((r) => ({ id: r.id, data: () => r })),
      }),
    ),
    mockBatchSet: vi.fn(),
    mockBatchCommit: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ kind: 'collection', path }),
  query: (...args: unknown[]) => ({ kind: 'query', args }),
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
  getDocs: mockGetDocs,
  doc: (_db: unknown, collectionPath: string, id: string) => ({
    path: `${collectionPath}/${id}`,
  }),
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
  serverTimestamp: () => 'server-timestamp',
  // bulkMergePerRow calls writeBatch; use module-level mocks so tests can
  // inspect cascade calls without re-mocking per test.
  writeBatch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

// useFirestoreCollection backs the live buildings list in the page.
vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({
    data: buildingsState.rows,
    loading: false,
    error: null,
  }),
}));

import { BuildingsPage } from './BuildingsPage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function omsBuilding(): Building & { id: string } {
  return {
    id: 'oms',
    buildingId: 'oms',
    displayName: 'OMS',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function adaStaff(): Staff & { id: string } {
  return {
    id: 'ada@orono.k12.mn.us',
    email: 'ada@orono.k12.mn.us',
    name: 'Ada Lovelace',
    role: 'teacher',
    year: 1,
    buildings: ['OMS'],
    modules: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function graceStaff(): Staff & { id: string } {
  return {
    ...adaStaff(),
    id: 'grace@orono.k12.mn.us',
    email: 'grace@orono.k12.mn.us',
    name: 'Grace Hopper',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BuildingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openEditDialog(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
  return await screen.findByRole('dialog', { name: 'Edit building' });
}

/**
 * Append a suffix to the display-name input so it differs from the
 * original value, triggering the rename-confirmation path. The final
 * display name becomes "<original><suffix>".
 */
async function appendToDisplayName(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  suffix: string,
) {
  const nameInput = within(dialog).getByLabelText('Display name');
  await user.click(nameInput);
  await user.type(nameInput, suffix);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockSetDoc.mockClear();
  mockDeleteDoc.mockClear();
  mockGetDocs.mockClear();
  mockBatchSet.mockClear();
  mockBatchCommit.mockClear();
  buildingsState.rows = [omsBuilding()];
  staffState.rows = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('BuildingsPage — rename cascade', () => {
  it('saves without cascade when the display name is unchanged', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openEditDialog(user, 'OMS');
    // Flip isActive — name stays 'OMS'.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Active' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });
    // getDocs for the staff affected-count query was NOT called.
    expect(mockGetDocs).not.toHaveBeenCalled();
    // Dialog closes.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit building' })).not.toBeInTheDocument();
    });
  });

  it('queries affected staff and shows a confirmation when the name changes', async () => {
    staffState.rows = [adaStaff(), graceStaff()];

    const user = userEvent.setup();
    renderPage();

    const dialog = await openEditDialog(user, 'OMS');
    // Append ' v2' → name becomes 'OMS v2', which differs from 'OMS'.
    await appendToDisplayName(user, dialog, ' v2');

    // First Save click — triggers the "check affected staff" path.
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    // getDocs must have been called to find affected staff.
    await waitFor(() => {
      expect(mockGetDocs).toHaveBeenCalledTimes(1);
    });
    // Building was NOT saved yet (awaiting confirmation).
    expect(mockSetDoc).not.toHaveBeenCalled();
    // The confirmation "Yes, rename" button must appear.
    await screen.findByRole('button', { name: 'Yes, rename' });
  });

  it('cancelling the rename confirmation re-shows the Save button without writing', async () => {
    staffState.rows = [adaStaff()];

    const user = userEvent.setup();
    renderPage();

    const dialog = await openEditDialog(user, 'OMS');
    await appendToDisplayName(user, dialog, ' v2');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Wait for the confirmation panel to appear.
    const yesBtn = await screen.findByRole('button', { name: 'Yes, rename' });

    // Cancel the rename confirmation. At this point the footer Cancel button
    // and the confirmation Cancel button are both present — find the one that
    // is a sibling of the "Yes, rename" button (same parent div).
    const confirmPanel = yesBtn.parentElement;
    if (!confirmPanel) throw new Error('Could not find confirm panel parent');
    await user.click(within(confirmPanel).getByRole('button', { name: 'Cancel' }));

    // The Save button in the footer should be visible again.
    await screen.findByRole('button', { name: 'Save' });
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('cascades the rename to all affected staff on confirmation', async () => {
    staffState.rows = [adaStaff()];

    const user = userEvent.setup();
    renderPage();

    const dialog = await openEditDialog(user, 'OMS');
    // Append ' v2' → renamed to 'OMS v2'.
    await appendToDisplayName(user, dialog, ' v2');

    // First Save: triggers count-check.
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Wait for the confirmation panel.
    await screen.findByRole('button', { name: 'Yes, rename' });

    // Confirm the rename.
    await user.click(screen.getByRole('button', { name: 'Yes, rename' }));

    // Building doc updated with the new display name.
    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledWith(
        { path: 'buildings/oms' },
        expect.objectContaining({ displayName: 'OMS v2' }),
        { merge: true },
      );
    });

    // Batch cascade committed.
    await waitFor(() => {
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    // Cascade patch sent to the staff doc: 'OMS' → 'OMS v2' in buildings array.
    expect(mockBatchSet).toHaveBeenCalledWith(
      { path: 'staff/ada@orono.k12.mn.us' },
      expect.objectContaining({ buildings: ['OMS v2'] }),
      { merge: true },
    );

    // Dialog closes after success.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit building' })).not.toBeInTheDocument();
    });
  });

  it('writes the building even when no staff are assigned, without a batch write', async () => {
    staffState.rows = [];

    const user = userEvent.setup();
    renderPage();

    const dialog = await openEditDialog(user, 'OMS');
    await appendToDisplayName(user, dialog, ' v2');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // Confirmation panel should appear even when no staff are affected.
    await screen.findByRole('button', { name: 'Yes, rename' });

    await user.click(screen.getByRole('button', { name: 'Yes, rename' }));

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledWith(
        { path: 'buildings/oms' },
        expect.objectContaining({ displayName: 'OMS v2' }),
        { merge: true },
      );
    });
    // No batch writes when no staff are affected.
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});
