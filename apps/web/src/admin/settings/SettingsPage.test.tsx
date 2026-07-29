import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@ops/shared';
import { SettingsPage } from './SettingsPage';

/**
 * Regression tests for the "destructive cross-admin overwrite" adversarial-
 * review finding on PR #75.
 *
 * useHydratedDraft (see apps/web/src/hooks/useHydratedDraft.ts) hydrates the
 * local form once per doc id, and the settings doc's id ('global') never
 * changes. So a Settings tab opened *before* another admin sets replyToEmail
 * keeps form.replyToEmail === undefined for its entire session, even though
 * the live onSnapshot data updates in the background. Before the fix,
 * save() unconditionally emitted `replyToEmail: form.replyToEmail ??
 * deleteField()`, so a save from that stale tab — even one that only
 * touched an unrelated field — would permanently delete the other admin's
 * saved reply-to address. The fix guards the deleteField() sentinel behind
 * a "touched this session" flag.
 */

const { setDocMock, DELETE_FIELD_SENTINEL, dataHolder } = vi.hoisted(() => {
  const DELETE_FIELD_SENTINEL = { __kind: 'deleteField-sentinel' } as const;
  return {
    setDocMock: vi.fn<
      (ref: unknown, data: Record<string, unknown>, opts: unknown) => Promise<void>
    >(() => Promise.resolve()),
    DELETE_FIELD_SENTINEL,
    dataHolder: { current: null as (Partial<AppSettings> & { id: string }) | null },
  };
});

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  setDoc: setDocMock,
  deleteField: () => DELETE_FIELD_SENTINEL,
  serverTimestamp: () => 'server-timestamp',
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin-b@orono.k12.mn.us' } }),
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: () => ({ data: dataHolder.current, loading: false, error: null }),
}));

vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('SettingsPage save() — reply-to cross-admin overwrite guard', () => {
  beforeEach(() => {
    setDocMock.mockClear();
  });

  it('does not delete replyToEmail on save when the field was never hydrated or touched in this session', async () => {
    // Admin B's tab hydrated from a doc snapshot taken *before* Admin A
    // saved a replyToEmail — the field is absent from the hydrated data,
    // exactly like the live doc updating in the background never being
    // re-hydrated into local state (useHydratedDraft hydrates once).
    dataHolder.current = {
      id: 'global',
      sessionDurationHours: 24,
      auditLogRetentionDays: 365,
      // replyToEmail intentionally absent.
    };

    const user = userEvent.setup();
    render(<SettingsPage />);

    // Admin B never touches the reply-to field at all, and saves.
    const saveButton = await screen.findByRole('button', { name: /save settings/i });
    await user.click(saveButton);

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const call = setDocMock.mock.calls[0];
    if (!call) throw new Error('setDoc was not called');
    const payload = call[1];
    expect(payload).not.toHaveProperty('replyToEmail');
    expect(Object.values(payload)).not.toContain(DELETE_FIELD_SENTINEL);
  });

  it('still deletes replyToEmail when the admin clears a previously-hydrated value in this session', async () => {
    dataHolder.current = {
      id: 'global',
      sessionDurationHours: 24,
      auditLogRetentionDays: 365,
      replyToEmail: 'frontoffice@orono.k12.mn.us',
    };

    const user = userEvent.setup();
    render(<SettingsPage />);

    const replyToInput = await screen.findByPlaceholderText('frontoffice@orono.k12.mn.us');
    expect(replyToInput).toHaveValue('frontoffice@orono.k12.mn.us');
    await user.clear(replyToInput);

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    await user.click(saveButton);

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const call = setDocMock.mock.calls[0];
    if (!call) throw new Error('setDoc was not called');
    const payload = call[1];
    expect(payload['replyToEmail']).toBe(DELETE_FIELD_SENTINEL);
  });

  it('keeps a hydrated replyToEmail value on save when the admin never touches that field', async () => {
    dataHolder.current = {
      id: 'global',
      sessionDurationHours: 24,
      auditLogRetentionDays: 365,
      replyToEmail: 'frontoffice@orono.k12.mn.us',
    };

    const user = userEvent.setup();
    render(<SettingsPage />);

    const saveButton = await screen.findByRole('button', { name: /save settings/i });
    await user.click(saveButton);

    expect(setDocMock).toHaveBeenCalledTimes(1);
    const call = setDocMock.mock.calls[0];
    if (!call) throw new Error('setDoc was not called');
    const payload = call[1];
    expect(payload['replyToEmail']).toBe('frontoffice@orono.k12.mn.us');
  });
});
