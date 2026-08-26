import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { APP_SETTINGS_DOC_ID, COLLECTIONS, type AppSettings } from '@ops/shared';

const { mockOnSnapshot } = vi.hoisted(() => ({ mockOnSnapshot: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string) => ({ kind: 'doc', path })),
  onSnapshot: mockOnSnapshot,
}));

import { useFirestoreDoc } from './useFirestoreDoc';

function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const wrapper = Wrapper;

/** Drive the `onSnapshot` callback with a document body (or a missing doc). */
function emit(data: Record<string, unknown> | null, id: string) {
  mockOnSnapshot.mockImplementation((_ref: unknown, next: (snap: unknown) => void) => {
    next({ exists: () => data !== null, data: () => data, id });
    return () => undefined;
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

describe('useFirestoreDoc', () => {
  it('fills in schema defaults the stored document is missing', async () => {
    // Regression: /appSettings/global predates `yearColors`, and
    // RoleYearMappingsPage reads `appSettings.yearColors[year]` — a property
    // access on undefined that took the whole page down.
    emit({ securityAdminEmail: 'admin@orono.k12.mn.us' }, APP_SETTINGS_DOC_ID);

    const { result } = renderHook(() => useFirestoreDoc<AppSettings>(SETTINGS_PATH), { wrapper });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });
    expect(result.current.data?.yearColors).toEqual({});
    expect(result.current.data?.globalBannerText).toBe('');
    expect(result.current.data?.id).toBe(APP_SETTINGS_DOC_ID);
  });

  it('leaves stored values alone', async () => {
    emit(
      { securityAdminEmail: 'admin@orono.k12.mn.us', yearColors: { 1: 'blue' } },
      APP_SETTINGS_DOC_ID,
    );

    const { result } = renderHook(() => useFirestoreDoc<AppSettings>(SETTINGS_PATH), { wrapper });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });
    expect(result.current.data?.yearColors).toEqual({ 1: 'blue' });
  });

  it('returns null for a document that does not exist', async () => {
    emit(null, APP_SETTINGS_DOC_ID);

    const { result } = renderHook(() => useFirestoreDoc<AppSettings>(SETTINGS_PATH), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBeNull();
  });

  it('passes documents through untouched when the path has no schema', async () => {
    emit({ to: 'someone@orono.k12.mn.us' }, 'msg-1');

    const { result } = renderHook(() => useFirestoreDoc(`${COLLECTIONS.mail}/msg-1`), { wrapper });

    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });
    expect(result.current.data).toEqual({ to: 'someone@orono.k12.mn.us', id: 'msg-1' });
  });
});
