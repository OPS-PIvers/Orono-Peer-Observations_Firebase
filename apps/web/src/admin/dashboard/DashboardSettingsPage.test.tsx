/**
 * DashboardSettingsPage — layout contract and the refused-save path.
 *
 * Firestore, auth and the live preview are mocked; what's under test is
 * the page shell: one scroll context (no nested scroller on the editor
 * pane), a 60/40 default split with a keyboard-reachable separator, and
 * that a draft failing the schema is never written, is announced in the
 * banner, and lands the admin on the tab that holds the problem.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSetDoc, docState } = vi.hoisted(() => ({
  mockSetDoc: vi.fn(() => Promise.resolve()),
  docState: {
    config: null as Record<string, unknown> | null,
    quick: null as Record<string, unknown> | null,
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  setDoc: mockSetDoc,
  serverTimestamp: () => 'ts',
  where: () => ({}),
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@example.test' } }),
}));
vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [], loading: false, error: null }),
}));
vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: (path: string) => ({
    data: path.startsWith('appSettings') ? docState.config : docState.quick,
    loading: false,
    error: null,
  }),
}));
// The real preview renders the full staff dashboard inside a
// ResizeObserver-driven zoom frame; jsdom has neither the observer nor
// layout. The page contract doesn't depend on its internals.
vi.mock('./DashboardPreview', () => ({
  DashboardPreview: () => <div data-testid="preview-stub">preview</div>,
}));

import { emptyAudience } from '@ops/shared';
import { DashboardSettingsPage } from './DashboardSettingsPage';
import { SPLITTER_STORAGE_KEY } from './useSplitter';

describe('DashboardSettingsPage', () => {
  beforeEach(() => {
    mockSetDoc.mockClear();
    localStorage.clear();
    docState.config = null;
    docState.quick = null;
  });

  it('renders one scroll context: the editor pane is not its own scroller', () => {
    render(<DashboardSettingsPage />);
    const editor = screen.getByTestId('dashboard-editor-pane');
    expect(editor.className).not.toMatch(/overflow-y-auto/);
    expect(editor.className).not.toMatch(/max-h-/);
    // The preview stays pinned while the page scrolls.
    expect(screen.getByTestId('dashboard-preview-pane').className).toMatch(/lg:sticky/);
  });

  it('defaults to a 60/40 editor-favoring split with a keyboard-operable separator', async () => {
    const user = userEvent.setup();
    render(<DashboardSettingsPage />);
    const editor = screen.getByTestId('dashboard-editor-pane');
    expect(editor.style.flexBasis).toBe('60%');

    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-orientation', 'vertical');
    expect(sep).toHaveAttribute('aria-valuenow', '60');

    sep.focus();
    await user.keyboard('{ArrowRight}');
    expect(editor.style.flexBasis).toBe('65%');
    expect(sep).toHaveAttribute('aria-valuenow', '65');
    expect(localStorage.getItem(SPLITTER_STORAGE_KEY)).toBe('0.65');
  });

  it('restores the persisted split on the next visit', () => {
    localStorage.setItem(SPLITTER_STORAGE_KEY, '0.4');
    render(<DashboardSettingsPage />);
    expect(screen.getByTestId('dashboard-editor-pane').style.flexBasis).toBe('40%');
  });

  it('refuses to save a blank material, names it, and jumps to the Quick materials tab', async () => {
    const user = userEvent.setup();
    render(<DashboardSettingsPage />);

    // Add a blank card on the materials tab, then go back to Layout so the
    // refused save has a tab to jump from.
    await user.click(screen.getByRole('tab', { name: /quick materials/i }));
    await user.click(screen.getByRole('button', { name: /add link/i }));
    await user.click(screen.getByRole('tab', { name: /^layout/i }));
    expect(screen.getByRole('tab', { name: /^layout/i })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mockSetDoc).not.toHaveBeenCalled();
    const banner = await screen.findByText(/Not saved\. Quick materials:/);
    expect(banner).toHaveTextContent('Link 1 (untitled)');
    expect(banner).toHaveTextContent('label');
    expect(banner).toHaveTextContent('Required.');

    // Tab switched, badge shows the count, and the field carries the error.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /quick materials/i })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByLabelText(/1 problem/)).toBeInTheDocument();
    const title = screen.getByLabelText('Title');
    expect(title).toHaveAttribute('aria-invalid', 'true');

    // Fixing the field clears the inline error; saving then writes.
    await user.type(title, 'Rubric');
    expect(title).not.toHaveAttribute('aria-invalid');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(2));
    const quickWrite = mockSetDoc.mock.calls
      .map((c) => c as unknown as [{ path: string }, { items?: unknown[] }])
      .find(([ref]) => ref.path.startsWith('dashboardQuickMaterials'));
    expect(quickWrite?.[1].items).toEqual([
      { label: 'Rubric', sub: '', icon: 'doc', url: '', audience: emptyAudience() },
    ]);
  });
});
