/**
 * StaffDialog — building-scoped mode (/building-staff). A building
 * Administrator must not be able to grant module or Admin Console access or
 * hand out an observer role, and their edits must not clobber those fields.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Building, ModuleDoc, Role, Staff } from '@ops/shared';

const { setDocMock, getDocMock } = vi.hoisted(() => ({
  setDocMock: vi.fn<(ref: unknown, data: Record<string, unknown>, opts: unknown) => Promise<void>>(
    () => Promise.resolve(),
  ),
  getDocMock: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: getDocMock,
  setDoc: setDocMock,
  serverTimestamp: () => 'server-timestamp',
  where: () => ({}),
  orderBy: () => ({}),
}));

vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {}, functions: {} }));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string) => {
    if (path === 'roles') {
      return {
        data: [
          { roleId: 'teacher', displayName: 'Classroom Teacher' },
          { roleId: 'administrator', displayName: 'Administrator' },
          { roleId: 'peer-evaluator', displayName: 'Peer Evaluator' },
        ] as Role[],
        loading: false,
        error: null,
      };
    }
    if (path === 'buildings') {
      return {
        data: [
          { buildingId: 'oms', displayName: 'OMS' },
          { buildingId: 'ohs', displayName: 'OHS' },
        ] as Building[],
        loading: false,
        error: null,
      };
    }
    if (path === 'modules') {
      return {
        data: [
          { moduleId: 'mentor', displayName: 'Mentor', description: '', color: 'blue' },
        ] as ModuleDoc[],
        loading: false,
        error: null,
      };
    }
    return { data: [], loading: false, error: null };
  },
}));

import { StaffDialog } from './StaffDialog';

const ann = {
  id: 'ann@orono.k12.mn.us',
  email: 'ann@orono.k12.mn.us',
  name: 'Ann',
  role: 'teacher',
  year: 1,
  buildings: ['OMS'],
  modules: ['mentor'],
  summativeYear: false,
  isActive: true,
  hasAdminAccess: true,
} as Staff & { id: string };

beforeEach(() => {
  setDocMock.mockClear();
});

describe('StaffDialog with buildingScope', () => {
  it('hides Module Access and special roles', () => {
    render(
      <StaffDialog
        open
        onOpenChange={vi.fn()}
        mode="edit"
        existing={ann}
        buildingScope={['OMS']}
      />,
    );
    expect(screen.queryByText('Module Access')).toBeNull();
    expect(screen.queryByRole('option', { name: 'Administrator' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Peer Evaluator' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Classroom Teacher' })).toBeTruthy();
  });

  it('leaves modules and hasAdminAccess untouched on edit', async () => {
    render(
      <StaffDialog
        open
        onOpenChange={vi.fn()}
        mode="edit"
        existing={ann}
        buildingScope={['OMS']}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const written = setDocMock.mock.calls[0]?.[1] ?? {};
    expect(written).not.toHaveProperty('modules');
    expect(written).not.toHaveProperty('hasAdminAccess');
    expect(written).toMatchObject({ name: 'Ann', buildings: ['OMS'] });
  });

  it("pre-fills a new record with the admin's building and writes no access", async () => {
    render(
      <StaffDialog
        open
        onOpenChange={vi.fn()}
        mode="create"
        existing={null}
        buildingScope={['OMS']}
      />,
    );
    await userEvent.type(screen.getByLabelText('Email'), 'new@orono.k12.mn.us');
    await userEvent.type(screen.getByLabelText('Name'), 'New Hire');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'teacher');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock.mock.calls[0]?.[1]).toMatchObject({
      buildings: ['OMS'],
      modules: [],
      hasAdminAccess: false,
    });
  });

  it("refuses to create someone outside the admin's buildings", async () => {
    render(
      <StaffDialog
        open
        onOpenChange={vi.fn()}
        mode="create"
        existing={null}
        buildingScope={['OMS']}
      />,
    );
    await userEvent.type(screen.getByLabelText('Email'), 'new@orono.k12.mn.us');
    await userEvent.type(screen.getByLabelText('Name'), 'New Hire');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'teacher');
    await userEvent.click(screen.getByRole('button', { name: 'Remove OMS' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(setDocMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Add OMS so this person shows up/)).toBeTruthy();
  });
});
