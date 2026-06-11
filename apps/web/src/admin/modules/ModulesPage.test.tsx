import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModuleDoc } from '@ops/shared';

// Hoisted so the vi.mock factories below (which Vitest lifts to the top of
// the file) can reference them without hitting the TDZ.
const { setDocMock, deleteDocMock, mentorRow } = vi.hoisted(() => {
  const mentorRow: ModuleDoc & { id: string } = {
    id: 'mentor',
    moduleId: 'mentor',
    displayName: 'Mentor',
    description: 'Veteran teachers mentoring new staff.',
    color: 'blue',
    isActive: true,
    hasPage: false,
    icon: 'shapes',
    sections: [],
    autoEnable: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  return {
    setDocMock: vi.fn(() => Promise.resolve()),
    deleteDocMock: vi.fn(() => Promise.resolve()),
    mentorRow,
  };
});

vi.mock('firebase/firestore', () => ({
  setDoc: setDocMock,
  deleteDoc: deleteDocMock,
  doc: (_db: unknown, collectionPath: string, id: string) => ({
    path: `${collectionPath}/${id}`,
  }),
  serverTimestamp: () => 'server-timestamp',
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [mentorRow], loading: false, error: null }),
}));

import { ModulesPage } from './ModulesPage';

beforeEach(() => {
  setDocMock.mockClear();
  deleteDocMock.mockClear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ModulesPage />
    </MemoryRouter>,
  );
}

async function openEditDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Actions for Mentor' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Edit details' }));
  return await screen.findByRole('dialog', { name: 'Edit module' });
}

describe('ModulesPage edit dialog', () => {
  it('offers both "Edit details" and "Open builder" row actions', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Actions for Mentor' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit details' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open builder' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('opens prefilled and saves name, description, color, active flag, and auto-enable', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openEditDialog(user);

    const nameInput = within(dialog).getByLabelText('Display name');
    expect(nameInput).toHaveValue('Mentor');
    // The slug is immutable after creation.
    expect(within(dialog).getByLabelText('Module ID')).toBeDisabled();

    await user.clear(nameInput);
    await user.type(nameInput, 'Mentor Program');

    const description = within(dialog).getByLabelText('Description (optional)');
    await user.clear(description);
    await user.type(description, 'Updated description');

    await user.click(within(dialog).getByRole('button', { name: 'green' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Active' }));

    await user.selectOptions(within(dialog).getByDisplayValue('Off (manual only)'), 'year');
    await user.selectOptions(await within(dialog).findByDisplayValue('Year 1'), '2');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setDocMock).toHaveBeenCalledTimes(1);
    });
    expect(setDocMock).toHaveBeenCalledWith(
      { path: 'modules/mentor' },
      {
        moduleId: 'mentor',
        displayName: 'Mentor Program',
        description: 'Updated description',
        color: 'green',
        isActive: false,
        autoEnable: { dimension: 'year', value: 2 },
        updatedAt: 'server-timestamp',
        updatedBy: 'admin@orono.k12.mn.us',
      },
      { merge: true },
    );

    // Saving closes the dialog.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit module' })).not.toBeInTheDocument();
    });
  });

  it('resets stale edits when the same row is reopened after a cancel', async () => {
    const user = userEvent.setup();
    renderPage();

    let dialog = await openEditDialog(user);
    const nameInput = within(dialog).getByLabelText('Display name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Abandoned edit');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit module' })).not.toBeInTheDocument();
    });

    dialog = await openEditDialog(user);
    expect(within(dialog).getByLabelText('Display name')).toHaveValue('Mentor');
    expect(setDocMock).not.toHaveBeenCalled();
  });
});
