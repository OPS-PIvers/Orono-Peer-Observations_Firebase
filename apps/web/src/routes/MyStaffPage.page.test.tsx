import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, Staff } from '@ops/shared';

const { staffHolder, rolesHolder, meHolder, setDocMock, viewingAs } = vi.hoisted(() => ({
  viewingAs: { current: false },
  staffHolder: { current: [] as (Staff & { id: string })[] },
  rolesHolder: { current: [] as (Role & { id: string })[] },
  meHolder: { current: null as (Staff & { id: string }) | null },
  setDocMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: setDocMock,
  serverTimestamp: () => 'server-timestamp',
  where: () => ({}),
  orderBy: () => ({}),
  getDoc: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {}, functions: {} }));

vi.mock('@/dev/DevModeContext', () => ({
  useEffectiveClaims: () => ({ role: 'administrator' }),
  useEffectiveEmail: () => 'principal@orono.k12.mn.us',
  useIsViewingAs: () => viewingAs.current,
}));

vi.mock('@/hooks/useNewObservationsDisabled', () => ({
  useNewObservationsDisabled: () => false,
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string) => {
    if (path === 'staff') return { data: staffHolder.current, loading: false, error: null };
    if (path === 'roles') return { data: rolesHolder.current, loading: false, error: null };
    return { data: [], loading: false, error: null };
  },
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: (path: string) =>
    path.startsWith('staff/')
      ? { data: meHolder.current, loading: false, error: null }
      : { data: null, loading: false, error: null },
}));

import { MyStaffPage } from './MyStaffPage';

function makeStaff(overrides: Partial<Staff>): Staff & { id: string } {
  const email = overrides.email ?? 'x@orono.k12.mn.us';
  return {
    id: email,
    email,
    name: 'Someone',
    role: 'teacher',
    year: 1,
    buildings: ['OMS'],
    modules: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    ...overrides,
  } as Staff & { id: string };
}

function makeRole(roleId: string, displayName: string): Role & { id: string } {
  return {
    id: roleId,
    roleId,
    displayName,
    rubricId: roleId,
    isActive: true,
    isSpecialAccess: false,
  } as unknown as Role & { id: string };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <MyStaffPage />
    </MemoryRouter>,
  );
}

/** The desktop table row for a person (the mobile card list renders too). */
function rowFor(name: string): HTMLElement {
  const row = screen.getAllByText(name)[0]?.closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

beforeEach(() => {
  setDocMock.mockClear();
  viewingAs.current = false;
  meHolder.current = makeStaff({
    email: 'principal@orono.k12.mn.us',
    name: 'Pat Principal',
    role: 'administrator',
    buildings: ['OMS'],
  });
  rolesHolder.current = [
    makeRole('teacher', 'Classroom Teacher'),
    makeRole('administrator', 'Administrator'),
  ];
  staffHolder.current = [
    meHolder.current,
    makeStaff({ email: 'ann@orono.k12.mn.us', name: 'Ann OMS', cycleStatus: 'high' }),
    makeStaff({ email: 'pia@orono.k12.mn.us', name: 'Pia OMS', cycleStatus: 'probationary' }),
    makeStaff({ email: 'dev@orono.k12.mn.us', name: 'Dev OMS', cycleStatus: 'developing' }),
    makeStaff({ email: 'hal@orono.k12.mn.us', name: 'Hal OHS', buildings: ['OHS'] }),
  ];
});

describe('MyStaffPage', () => {
  it("lists everyone in the admin's building, and only them", () => {
    renderPage();
    expect(screen.getAllByText('Ann OMS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dev OMS').length).toBeGreaterThan(0);
    expect(screen.queryByText('Hal OHS')).toBeNull();
  });

  it('filters by the Probationary and High Cycle tabs', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'All (4)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Probationary (1)' }));
    expect(screen.getAllByText('Pia OMS').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ann OMS')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'High Cycle (1)' }));
    expect(screen.getAllByText('Ann OMS').length).toBeGreaterThan(0);
    expect(screen.queryByText('Dev OMS')).toBeNull();
  });

  it('is read-only until Edit roster', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Role for Ann OMS' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add staff' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Ann OMS' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit roster' }));
    expect(screen.getAllByRole('button', { name: 'Role for Ann OMS' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Add staff' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Actions for Ann OMS' }).length).toBeGreaterThan(
      0,
    );
    // Special-role rows stay read-only even in edit mode.
    expect(screen.queryByRole('button', { name: 'Role for Pat Principal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Pat Principal' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('button', { name: 'Role for Ann OMS' })).toBeNull();
  });

  it('shows New only for staff the admin can observe', () => {
    renderPage();
    const start = (name: string) =>
      within(rowFor(name)).queryByRole<HTMLButtonElement>('button', {
        name: /^New observation for/,
      });
    expect(start('Ann OMS')?.disabled).toBe(false);
    expect(start('Pia OMS')?.disabled).toBe(false);
    // Developing status: not on the evaluation list, so no button at all.
    expect(start('Dev OMS')).toBeNull();
    expect(
      within(rowFor('Dev OMS')).getByRole('link', { name: 'View all observations for Dev OMS' }),
    ).toBeTruthy();
  });

  it('asks before an edit drops someone off the evaluation list', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit roster' }));
    const menu = within(rowFor('Ann OMS')).getByRole('button', { name: 'Actions for Ann OMS' });
    fireEvent.pointerDown(menu, { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive staff member' }));

    expect(screen.getByText('Remove from your evaluation list?')).toBeTruthy();
    expect(setDocMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });

  it('is fully read-only while a developer views as the admin', () => {
    viewingAs.current = true;
    renderPage();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Edit roster' }).disabled).toBe(
      true,
    );
    const start = within(rowFor('Ann OMS')).getByRole<HTMLButtonElement>('button', {
      name: /^New observation for/,
    });
    expect(start.disabled).toBe(true);
    expect(start.getAttribute('aria-label')).toMatch(/viewing as/i);
  });

  it('explains when the admin has no building', () => {
    meHolder.current = makeStaff({
      email: 'principal@orono.k12.mn.us',
      role: 'administrator',
      buildings: [],
    });
    renderPage();
    expect(screen.getByText(/building assignment isn.t configured/i)).toBeTruthy();
  });
});
