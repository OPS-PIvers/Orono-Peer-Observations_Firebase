/**
 * EmailTemplatesPage — toast error path tests.
 *
 * Verifies that failed writes (toggleActive, createTemplate, deleteTemplate)
 * surface a toast.error rather than silently failing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailTemplate } from '@ops/shared';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { templatesState, mockSetDoc, mockDeleteDoc, mockToastError } = vi.hoisted(() => {
  const templatesState: { rows: (EmailTemplate & { id: string })[] } = { rows: [] };
  return {
    templatesState,
    mockSetDoc: vi.fn(() => Promise.resolve()),
    mockDeleteDoc: vi.fn(() => Promise.resolve()),
    mockToastError: vi.fn(),
  };
});

vi.mock('sonner', () => ({
  toast: { error: mockToastError },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collectionPath: string, id: string) => ({ path: `${collectionPath}/${id}` }),
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
  serverTimestamp: () => 'server-timestamp',
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(() => Promise.resolve({ data: { sent: true } })),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => ({ appName: 'OPS', logoUrl: '' }),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({
    data: templatesState.rows,
    loading: false,
    error: null,
  }),
}));

// EmailBodyField pulls in TipTap; stub it to avoid editor setup overhead.
vi.mock('./EmailBodyField', () => ({
  EmailBodyField: () => <div data-testid="email-body-field" />,
}));

import { EmailTemplatesPage } from './EmailTemplatesPage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeTemplate(overrides: Partial<EmailTemplate & { id: string }> = {}): EmailTemplate & {
  id: string;
} {
  return {
    id: 'tpl-1',
    templateId: 'tpl-1',
    name: 'Test Template',
    description: 'desc',
    subject: 'Subject',
    bodyHtml: '<p>Body</p>',
    variables: [],
    triggerType: 'manual',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <EmailTemplatesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  templatesState.rows = [makeTemplate()];
  mockSetDoc.mockClear();
  mockDeleteDoc.mockClear();
  mockToastError.mockClear();
  mockSetDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('EmailTemplatesPage — toggleActive toast error', () => {
  it('calls toast.error when the active-toggle setDoc fails', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('permission-denied'));

    const user = userEvent.setup();
    renderPage();

    // The active toggle is the first role="switch" in the list.
    const toggle = await screen.findByRole('switch');
    await user.click(toggle);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to update template',
      expect.objectContaining({ description: 'permission-denied' }),
    );
  });
});

describe('EmailTemplatesPage — createTemplate toast error', () => {
  it('calls toast.error when the create setDoc fails', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('quota-exceeded'));

    const user = userEvent.setup();
    renderPage();

    const newBtn = screen.getByRole('button', { name: /new template/i });
    await user.click(newBtn);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to create template',
      expect.objectContaining({ description: 'quota-exceeded' }),
    );
  });
});

describe('EmailTemplatesPage — deleteTemplate toast error', () => {
  it('calls toast.error when the delete deleteDoc fails', async () => {
    // Make the template deletable (non-system) and expand the editor so the
    // Delete button is visible.
    templatesState.rows = [makeTemplate({ isSystem: false })];
    mockDeleteDoc.mockRejectedValueOnce(new Error('network-error'));

    const user = userEvent.setup();
    renderPage();

    // Open the inline editor first.
    const editBtn = screen.getByRole('button', { name: /edit/i });
    await user.click(editBtn);

    // Now the Delete button should be visible in the expanded editor.
    const deleteBtn = await screen.findByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    // Confirm in the dialog.
    const confirmBtn = await screen.findByRole('button', { name: /^delete$/i });
    await user.click(confirmBtn);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to delete template',
      expect.objectContaining({ description: 'network-error' }),
    );
  });
});
