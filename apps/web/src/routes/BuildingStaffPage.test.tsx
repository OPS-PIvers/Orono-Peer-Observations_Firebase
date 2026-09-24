import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, Staff } from '@ops/shared';

const { staffHolder, rolesHolder, meHolder } = vi.hoisted(() => ({
  staffHolder: { current: [] as (Staff & { id: string })[] },
  rolesHolder: { current: [] as (Role & { id: string })[] },
  meHolder: { current: null as (Staff & { id: string }) | null },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: () => 'server-timestamp',
  where: () => ({}),
  orderBy: () => ({}),
  getDoc: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {}, functions: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'principal@orono.k12.mn.us' } }),
}));

vi.mock('@/dev/DevModeContext', () => ({
  useDevMode: () => ({ override: { role: null, building: null } }),
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

import { BuildingStaffPage } from './BuildingStaffPage';

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

beforeEach(() => {
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
    makeStaff({ email: 'ann@orono.k12.mn.us', name: 'Ann OMS', buildings: ['OMS'] }),
    makeStaff({ email: 'hal@orono.k12.mn.us', name: 'Hal OHS', buildings: ['OHS'] }),
  ];
});

describe('BuildingStaffPage', () => {
  it("lists only staff in the admin's building", () => {
    render(<BuildingStaffPage />);
    expect(screen.getAllByText('Ann OMS').length).toBeGreaterThan(0);
    expect(screen.queryByText('Hal OHS')).toBeNull();
  });

  it('makes teacher rows editable and special-role rows read-only', () => {
    render(<BuildingStaffPage />);
    expect(screen.getAllByRole('button', { name: 'Role for Ann OMS' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Role for Pat Principal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Pat Principal' })).toBeNull();
  });

  it('offers Add staff and an Edit entry for editable rows', () => {
    render(<BuildingStaffPage />);
    expect(screen.getByRole('button', { name: 'Add staff' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Actions for Ann OMS' }).length).toBeGreaterThan(
      0,
    );
  });

  it('explains when the admin has no building', () => {
    meHolder.current = makeStaff({
      email: 'principal@orono.k12.mn.us',
      role: 'administrator',
      buildings: [],
    });
    render(<BuildingStaffPage />);
    expect(screen.getByText(/building assignment isn.t configured/i)).toBeTruthy();
  });
});
