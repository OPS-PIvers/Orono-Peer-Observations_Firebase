/**
 * Tests for the multi-active-WP/IR-observation fix.
 *
 * Covers:
 *  1. MyRubricPage renders one answer form per active WP observation, each
 *     with an observer/date header.
 *  2. MyRubricPage renders one answer form per active IR observation.
 *  3. CreateObservationDialog shows a duplicate warning when the staff member
 *     already has a draft of the chosen WP/IR type.
 *  4. CreateObservationDialog does NOT warn for the Standard type.
 */
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Observation, type Staff, observation as observationSchema } from '@ops/shared';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before vi.mock() factories reference them.
// ---------------------------------------------------------------------------
const { mockGetCountFromServer, mockUseFirestoreCollection, mockUseFirestoreDoc, activeObsState } =
  vi.hoisted(() => {
    const activeObsState = {
      workProducts: [] as (Observation & { id: string })[],
      instructionalRounds: [] as (Observation & { id: string })[],
    };
    return {
      activeObsState,
      mockGetCountFromServer: vi.fn(() => Promise.resolve({ data: () => ({ count: 0 }) })),
      mockUseFirestoreCollection: vi.fn(() => ({ data: [], loading: false, error: null })),
      mockUseFirestoreDoc: vi.fn(() => ({ data: null, loading: false, error: null })),
    };
  });

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ({ kind: 'collection', path }),
  query: (...args: unknown[]) => ({ kind: 'query', args }),
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value }),
  orderBy: (field: string, dir?: string) => ({ type: 'orderBy', field, dir }),
  limit: (n: number) => ({ type: 'limit', n }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: vi.fn(() => Promise.resolve()),
  getCountFromServer: mockGetCountFromServer,
  serverTimestamp: () => 'server-ts',
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: mockUseFirestoreCollection,
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: mockUseFirestoreDoc,
}));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'alice@orono.k12.mn.us' } }),
}));

// Active observation context reads from mutable `activeObsState`.
vi.mock('@/observations/ActiveObservationTypesContext', () => ({
  useActiveObservationTypes: () => ({
    standard: null,
    workProducts: activeObsState.workProducts,
    instructionalRounds: activeObsState.instructionalRounds,
    workProduct: activeObsState.workProducts[0] ?? null,
    instructionalRound: activeObsState.instructionalRounds[0] ?? null,
    hasWorkProduct: activeObsState.workProducts.length > 0,
    hasInstructionalRound: activeObsState.instructionalRounds.length > 0,
  }),
}));

// Stub heavy UI sub-components so tests only exercise the layout logic.
vi.mock('@/observations/WorkProductAnswerForm', () => ({
  WorkProductAnswerForm: ({ observation }: { observation: Observation & { id: string } }) => (
    <div data-testid={`wp-form-${observation.id}`}>WP Form {observation.id}</div>
  ),
}));

vi.mock('@/observations/InstructionalRoundAnswerForm', () => ({
  InstructionalRoundAnswerForm: ({
    observation,
  }: {
    observation: Observation & { id: string };
  }) => <div data-testid={`ir-form-${observation.id}`}>IR Form {observation.id}</div>,
}));

vi.mock('@/observations/RecentObservationsStrip', () => ({
  RecentObservationsStrip: () => null,
}));

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/rubric', () => ({
  AssignmentToggle: () => null,
  RubricGrid: () => null,
}));

vi.mock('@/utils/roleLookup', () => ({
  roleDisplayName: () => 'Teacher',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObs(
  id: string,
  type: 'Work Product' | 'Instructional Round',
  observerEmail = 'pe@orono.k12.mn.us',
): Observation & { id: string } {
  return {
    ...observationSchema.parse({
      observationId: id,
      observerEmail,
      observedEmail: 'alice@orono.k12.mn.us',
      observedName: 'Alice Example',
      observedRole: 'teacher',
      observedYear: 1,
      type,
      observationDate: new Date('2026-03-10'),
      createdAt: new Date('2026-03-10'),
      lastModifiedAt: new Date('2026-03-10'),
    }),
    id,
  };
}

const mockStaff: Staff = {
  email: 'alice@orono.k12.mn.us',
  name: 'Alice Example',
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

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
  // Reset active obs state between tests.
  activeObsState.workProducts = [];
  activeObsState.instructionalRounds = [];
});

// ---------------------------------------------------------------------------
// Import components under test AFTER mocks are registered.
// ---------------------------------------------------------------------------
import { MyRubricPage } from '@/routes/MyRubricPage';
import { CreateObservationDialog } from './CreateObservationDialog';

// ---------------------------------------------------------------------------
// MyRubricPage tests
// ---------------------------------------------------------------------------

describe('MyRubricPage — multiple active WP/IR observations', () => {
  beforeEach(() => {
    // Cast to unknown so TypeScript doesn't reject Staff & { id } → null mismatch
    // from the hoisted mock's inferred return type.
    (mockUseFirestoreDoc as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockStaff, id: mockStaff.email },
      loading: false,
      error: null,
    });
    mockUseFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });
  });

  it('renders a separate WP form for each active WP observation', () => {
    activeObsState.workProducts = [
      makeObs('wp-1', 'Work Product'),
      makeObs('wp-2', 'Work Product'),
    ];
    render(<MyRubricPage />, { wrapper: Wrapper });
    expect(screen.getByTestId('wp-form-wp-1')).toBeInTheDocument();
    expect(screen.getByTestId('wp-form-wp-2')).toBeInTheDocument();
  });

  it('shows the observer handle in the header when observationName is blank', () => {
    activeObsState.workProducts = [makeObs('wp-1', 'Work Product', 'smith@orono.k12.mn.us')];
    render(<MyRubricPage />, { wrapper: Wrapper });
    expect(screen.getByText(/smith/i)).toBeInTheDocument();
  });

  it('renders a separate IR form for each active IR observation', () => {
    activeObsState.instructionalRounds = [
      makeObs('ir-1', 'Instructional Round'),
      makeObs('ir-2', 'Instructional Round'),
    ];
    render(<MyRubricPage />, { wrapper: Wrapper });
    expect(screen.getByTestId('ir-form-ir-1')).toBeInTheDocument();
    expect(screen.getByTestId('ir-form-ir-2')).toBeInTheDocument();
  });

  it('renders nothing when there are no active WP or IR observations', () => {
    render(<MyRubricPage />, { wrapper: Wrapper });
    expect(screen.queryByTestId(/wp-form/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/ir-form/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CreateObservationDialog duplicate-warning tests
// ---------------------------------------------------------------------------

describe('CreateObservationDialog — duplicate draft warning', () => {
  function renderDialog(open = true) {
    render(
      <CreateObservationDialog
        open={open}
        onOpenChange={vi.fn()}
        staff={mockStaff}
        onCreated={vi.fn()}
      />,
      { wrapper: Wrapper },
    );
  }

  it('shows a warning banner when a WP draft already exists', async () => {
    mockGetCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 1 }) });
    renderDialog();

    const user = userEvent.setup();
    const select = screen.getByLabelText(/type/i);
    await user.selectOptions(select, 'Work Product');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/already has 1 active draft/i);
    });
  });

  it('uses plural "observations" when count is 2', async () => {
    mockGetCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 2 }) });
    renderDialog();

    const user = userEvent.setup();
    const select = screen.getByLabelText(/type/i);
    await user.selectOptions(select, 'Work Product');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/2 active draft observations/i);
    });
  });

  it('shows a warning for IR type as well', async () => {
    mockGetCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 1 }) });
    renderDialog();

    const user = userEvent.setup();
    const select = screen.getByLabelText(/type/i);
    await user.selectOptions(select, 'Instructional Round');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/already has 1 active draft/i);
    });
  });

  it('does NOT show a warning when count is 0', async () => {
    mockGetCountFromServer.mockResolvedValueOnce({ data: () => ({ count: 0 }) });
    renderDialog();

    const user = userEvent.setup();
    const select = screen.getByLabelText(/type/i);
    await user.selectOptions(select, 'Work Product');

    await waitFor(() => {
      expect(mockGetCountFromServer).toHaveBeenCalled();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does NOT query or warn for Standard type', async () => {
    renderDialog();
    // Standard is pre-selected — give effects a tick to settle.
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
    expect(mockGetCountFromServer).not.toHaveBeenCalled();
  });
});
