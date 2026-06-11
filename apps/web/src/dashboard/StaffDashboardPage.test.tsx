/**
 * StaffDashboardPage — toast error path tests.
 *
 * Verifies that:
 *  1. ackMutation.onError fires toast.error when the acknowledge write fails.
 *  2. onCompleteModuleItem fires toast.error when the setDoc write fails.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@ops/shared';

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before vi.mock factories reference them.
// ---------------------------------------------------------------------------
const { mockUpdateDoc, mockSetDoc, mockToastError, mockUseFirestoreCollection } = vi.hoisted(
  () => ({
    mockUpdateDoc: vi.fn(() => Promise.resolve()),
    mockSetDoc: vi.fn(() => Promise.resolve()),
    mockToastError: vi.fn(),
    mockUseFirestoreCollection: vi.fn(() => ({
      data: [] as unknown[],
      loading: false,
      error: null as Error | null,
    })),
  }),
);

vi.mock('sonner', () => ({
  toast: { error: mockToastError },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: mockUpdateDoc,
  setDoc: mockSetDoc,
  serverTimestamp: () => 'server-timestamp',
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'alice@orono.k12.mn.us' } }),
}));

const mockStaff: Staff & { id: string } = {
  id: 'alice@orono.k12.mn.us',
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

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: () => ({
    data: mockStaff,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: mockUseFirestoreCollection,
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return actual;
});

vi.mock('@/observations/ActiveObservationTypesContext', () => ({
  useActiveObservationTypes: () => ({
    standard: null,
    workProducts: [],
    instructionalRounds: [],
    workProduct: null,
    instructionalRound: null,
    hasWorkProduct: false,
    hasInstructionalRound: false,
  }),
}));

// DashboardView renders the acknowledgement button; we stub it to expose
// the onAcknowledge / onCompleteModuleItem props without full render overhead.
vi.mock('./DashboardView', () => ({
  DashboardView: ({
    onAcknowledge,
    onCompleteModuleItem,
    loadError,
  }: {
    onAcknowledge: (id: string) => void;
    onCompleteModuleItem: (moduleId: string, itemId: string) => void;
    acknowledging: boolean;
    loadError?: Error | null;
  }) => (
    <div>
      {loadError ? (
        <div data-testid="load-error">Couldn&apos;t load your checkpoints — please refresh</div>
      ) : null}
      <button type="button" onClick={() => onAcknowledge('obs-1')} data-testid="ack-button">
        Acknowledge
      </button>
      <button
        type="button"
        onClick={() => onCompleteModuleItem('mod-1', 'item-1')}
        data-testid="complete-button"
      >
        Complete item
      </button>
    </div>
  ),
}));

import { StaffDashboardPage } from './StaffDashboardPage';

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
        <StaffDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUpdateDoc.mockClear();
  mockSetDoc.mockClear();
  mockToastError.mockClear();
  mockUpdateDoc.mockResolvedValue(undefined);
  mockSetDoc.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('StaffDashboardPage — ackMutation toast error', () => {
  it('calls toast.error when the acknowledge updateDoc fails', async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error('permission-denied'));

    const user = userEvent.setup();
    renderPage();

    const btn = await screen.findByTestId('ack-button');
    await user.click(btn);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to acknowledge observation',
      expect.objectContaining({ description: 'permission-denied' }),
    );
  });
});

describe('StaffDashboardPage — onCompleteModuleItem toast error', () => {
  it('calls toast.error when the module-progress setDoc fails', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('quota-exceeded'));

    const user = userEvent.setup();
    renderPage();

    const btn = await screen.findByTestId('complete-button');
    await user.click(btn);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to mark item complete',
      expect.objectContaining({ description: 'quota-exceeded' }),
    );
  });
});

describe('StaffDashboardPage — listener error state', () => {
  it('renders an error alert when a critical listener fails', async () => {
    mockUseFirestoreCollection.mockImplementation(
      () =>
        ({
          data: null,
          loading: false,
          error: new Error('permission-denied'),
        }) as unknown as ReturnType<typeof mockUseFirestoreCollection>,
    );

    renderPage();

    await waitFor(() => {
      const errorAlert = screen.getByTestId('load-error');
      expect(errorAlert).toBeInTheDocument();
    });
  });

  afterEach(() => {
    mockUseFirestoreCollection.mockReset();
    mockUseFirestoreCollection.mockImplementation(() => ({
      data: [] as unknown[],
      loading: false,
      error: null as Error | null,
    }));
  });
});
