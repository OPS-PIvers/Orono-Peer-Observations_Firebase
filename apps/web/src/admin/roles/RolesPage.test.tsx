import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, Rubric } from '@ops/shared';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock() factories use them.
// ---------------------------------------------------------------------------
const { mockSetDoc, mockDeleteDoc, rolesState, rubricsState } = vi.hoisted(() => {
  const rolesState = {
    rows: [] as (Role & { id: string })[],
  };
  const rubricsState = {
    rows: [] as (Rubric & { id: string })[],
  };
  return {
    rolesState,
    rubricsState,
    mockSetDoc: vi.fn(() => Promise.resolve()),
    mockDeleteDoc: vi.fn(() => Promise.resolve()),
  };
});

const { mockGetCountFromServer } = vi.hoisted(() => ({
  mockGetCountFromServer: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ kind: 'collection', path }),
  query: (...args: unknown[]) => ({ kind: 'query', args }),
  doc: (_db: unknown, collectionPath: string, id: string) => ({
    path: `${collectionPath}/${id}`,
  }),
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
  getCountFromServer: mockGetCountFromServer,
  serverTimestamp: () => 'server-timestamp',
  where: (field: string, op: string, value: string) => ({ field, op, value }),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

// Hook up useFirestoreCollection to return either roles or rubrics depending on collection
vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (collection: string) => {
    if (collection === 'rubrics') {
      return {
        data: rubricsState.rows,
        loading: false,
        error: null,
      };
    }
    // default: roles
    return {
      data: rolesState.rows,
      loading: false,
      error: null,
    };
  },
}));

import { RolesPage } from './RolesPage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function teacherRole(): Role & { id: string } {
  return {
    id: 'teacher',
    roleId: 'teacher',
    displayName: 'Teacher',
    rubricId: 'teacher',
    isSpecialAccess: false,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function teacherRubric(): Rubric & { id: string } {
  return {
    id: 'teacher',
    rubricId: 'teacher',
    displayName: 'Teacher Rubric',
    domains: [
      {
        id: '1',
        name: 'Planning & Preparation',
        components: [
          {
            id: '1a',
            title: 'Component 1a',
            proficiencyLevels: {
              developing: 'Developing',
              basic: 'Basic',
              proficient: 'Proficient',
              distinguished: 'Distinguished',
            },
            lookFors: [],
          },
        ],
      },
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function specialRubric(): Rubric & { id: string } {
  return {
    id: 'librarian',
    rubricId: 'librarian',
    displayName: 'Librarian Rubric',
    domains: [
      {
        id: '1',
        name: 'Planning & Preparation',
        components: [
          {
            id: '1a',
            title: 'Component 1a',
            proficiencyLevels: {
              developing: 'Developing',
              basic: 'Basic',
              proficient: 'Proficient',
              distinguished: 'Distinguished',
            },
            lookFors: [],
          },
        ],
      },
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
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
        <RolesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openEditDialog(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
  return await screen.findByRole('dialog', { name: 'Edit role' });
}

async function openCreateDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add role' }));
  return await screen.findByRole('dialog', { name: 'Add role' });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockSetDoc.mockClear();
  mockDeleteDoc.mockClear();
  mockGetCountFromServer.mockClear();
  mockGetCountFromServer.mockReset();
  rolesState.rows = [teacherRole()];
  rubricsState.rows = [teacherRubric(), specialRubric()];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RolesPage — rubric validation', () => {
  it('shows existing rubrics in the rubric ID dropdown', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openEditDialog(user, 'Teacher');
    const rubricButton = within(dialog).getByRole('button', { name: 'Rubric ID' });

    // Open the dropdown by clicking the rubric button
    await user.click(rubricButton);

    // Should see both rubrics in the dropdown
    expect(screen.getByText('Teacher Rubric')).toBeInTheDocument();
    expect(screen.getByText('Librarian Rubric')).toBeInTheDocument();
    // Should also see the "same as role ID" option
    expect(screen.getByText(/same as role ID — will need creating/)).toBeInTheDocument();
  });

  it('saves immediately when the selected rubric exists', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openCreateDialog(user);

    // Fill in the form
    await user.type(within(dialog).getByLabelText('Display name'), 'Librarian');
    await user.type(within(dialog).getByLabelText('Role ID'), 'librarian-1');

    // Open the rubric dropdown and select "librarian" which exists
    const rubricButton = within(dialog).getByRole('button', { name: 'Rubric ID' });
    await user.click(rubricButton);

    // Click the librarian rubric option
    await user.click(screen.getByText('Librarian Rubric'));

    // Now click Create
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    // Should save immediately without warning
    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
    });

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add role' })).not.toBeInTheDocument();
    });
  });
});

describe('RolesPage — delete role with reference check', () => {
  it('calls getCountFromServer when delete button is clicked', async () => {
    mockGetCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 0 }) });
    mockGetCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 0 }) });

    const user = userEvent.setup();
    renderPage();

    const dialog = await openEditDialog(user, 'Teacher');

    // Click the "Delete role" button
    await user.click(within(dialog).getByRole('button', { name: 'Delete role' }));

    // Should have called getCountFromServer twice (for staff and observations)
    await waitFor(() => {
      expect(mockGetCountFromServer).toHaveBeenCalledTimes(2);
    });
  });
});
