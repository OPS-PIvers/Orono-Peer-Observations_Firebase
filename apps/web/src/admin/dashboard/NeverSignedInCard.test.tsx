/**
 * NeverSignedInCard — query shape, empty behavior, and resend wiring.
 *
 * The Firestore subscription and the callable are both mocked; what's under
 * test is that the card asks for exactly `isActive == true` +
 * `lastSignInAt == null`, stays out of the way when nobody is outstanding,
 * and reports the two distinct outcomes of `resendStaffInvite`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@ops/shared';

const { collectionState, mockCallable, capturedConstraints } = vi.hoisted(() => ({
  collectionState: {
    data: null as (Staff & { id: string })[] | null,
    loading: false,
    error: null as Error | null,
  },
  mockCallable: vi.fn(() => Promise.resolve({ data: { sent: true } })),
  capturedConstraints: [] as { field: string; op: string; value: unknown }[][],
}));

vi.mock('firebase/firestore', () => ({
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (_path: string, constraints: unknown[]) => {
    capturedConstraints.push(constraints as { field: string; op: string; value: unknown }[]);
    return collectionState;
  },
}));

import { NeverSignedInCard } from './NeverSignedInCard';

function makeStaff(overrides: Partial<Staff> = {}): Staff & { id: string } {
  return {
    id: overrides.email ?? 'jane.doe@orono.k12.mn.us',
    email: 'jane.doe@orono.k12.mn.us',
    name: 'Jane Doe',
    role: 'teacher',
    year: 1,
    buildings: [],
    modules: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    emailPreferences: {
      observationNotices: true,
      reminders: true,
      schedulingUpdates: true,
      manualMessages: true,
    },
    lastSignInAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  collectionState.data = null;
  collectionState.loading = false;
  collectionState.error = null;
  capturedConstraints.length = 0;
  mockCallable.mockClear();
  mockCallable.mockResolvedValue({ data: { sent: true } });
});

describe('NeverSignedInCard', () => {
  it('queries active staff with an explicitly null lastSignInAt', () => {
    render(<NeverSignedInCard />);
    expect(capturedConstraints[0]).toEqual([
      { field: 'isActive', op: '==', value: true },
      { field: 'lastSignInAt', op: '==', value: null },
    ]);
  });

  it('renders nothing when everyone has signed in', () => {
    collectionState.data = [];
    const { container } = render(<NeverSignedInCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the subscription is still loading', () => {
    collectionState.loading = true;
    const { container } = render(<NeverSignedInCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists outstanding staff sorted by name', () => {
    collectionState.data = [
      makeStaff({ email: 'zed@orono.k12.mn.us', name: 'Zed Zebra' }),
      makeStaff({ email: 'amy@orono.k12.mn.us', name: 'Amy Apple' }),
    ];
    render(<NeverSignedInCard />);
    const names = screen.getAllByText(/Apple|Zebra/).map((el) => el.textContent);
    expect(names).toEqual(['Amy Apple', 'Zed Zebra']);
  });

  it('resends the invite for the clicked person only', async () => {
    collectionState.data = [
      makeStaff({ email: 'amy@orono.k12.mn.us', name: 'Amy Apple' }),
      makeStaff({ email: 'zed@orono.k12.mn.us', name: 'Zed Zebra' }),
    ];
    render(<NeverSignedInCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Resend invite to Zed Zebra' }));
    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalledWith({ email: 'zed@orono.k12.mn.us' });
    });
    expect(mockCallable).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Invite re-sent')).toBeInTheDocument();
  });

  it('flags a missing staff.created template instead of claiming success', async () => {
    collectionState.data = [makeStaff()];
    mockCallable.mockResolvedValue({ data: { sent: false } });
    render(<NeverSignedInCard />);
    await userEvent.click(screen.getByRole('button', { name: 'Resend invite to Jane Doe' }));
    expect(await screen.findByText(/No active .*email template/)).toBeInTheDocument();
  });

  it('surfaces a load failure rather than hiding the card', () => {
    collectionState.error = new Error('permission denied');
    render(<NeverSignedInCard />);
    expect(screen.getByText(/permission denied/)).toBeInTheDocument();
  });
});
