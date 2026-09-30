import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@ops/shared';

const { scopeHolder } = vi.hoisted(() => ({
  scopeHolder: { current: { role: 'administrator', buildings: ['OMS'], loading: false } },
}));

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {}, functions: {} }));

vi.mock('@/hooks/useObserverScope', () => ({
  useObserverScope: () => scopeHolder.current,
}));

const staff = (email: string, name: string, over: Partial<Staff> = {}) =>
  ({
    id: email,
    email,
    name,
    role: 'teacher',
    year: 2,
    cycleStatus: 'high',
    buildings: ['OMS'],
    isActive: true,
    ...over,
  }) as Staff & { id: string };

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string) =>
    path === 'staff'
      ? {
          data: [
            staff('ann@orono.k12.mn.us', 'Ann High'),
            staff('dev@orono.k12.mn.us', 'Dev Developing', { cycleStatus: 'developing' }),
            staff('hal@orono.k12.mn.us', 'Hal Elsewhere', { buildings: ['OHS'] }),
          ],
          loading: false,
          error: null,
        }
      : { data: [], loading: false, error: null },
}));

import { NewObservationPage } from './NewObservationPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <NewObservationPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  scopeHolder.current = { role: 'administrator', buildings: ['OMS'], loading: false };
});

describe('NewObservationPage', () => {
  it('shows a building Administrator only the staff they can observe', () => {
    renderPage();
    expect(screen.getAllByText('Ann High').length).toBeGreaterThan(0);
    expect(screen.queryByText('Dev Developing')).toBeNull();
    expect(screen.queryByText('Hal Elsewhere')).toBeNull();
  });

  it('shows a Peer Evaluator everyone', () => {
    scopeHolder.current = { role: 'peer-evaluator', buildings: [], loading: false };
    renderPage();
    expect(screen.getAllByText('Dev Developing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hal Elsewhere').length).toBeGreaterThan(0);
  });
});
