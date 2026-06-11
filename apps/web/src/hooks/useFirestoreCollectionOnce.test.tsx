import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockGetDocs } = vi.hoisted(() => ({ mockGetDocs: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ kind: 'collection' })),
  query: vi.fn((...args: unknown[]) => ({ kind: 'query', args })),
  getDocs: mockGetDocs,
}));

import { useFirestoreCollectionOnce } from './useFirestoreCollectionOnce';

function Wrapper({ children }: { children: ReactNode }) {
  // Lazy state so the client survives re-renders of the same hook tree
  // (each test still gets a fresh client on its own mount).
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const wrapper = Wrapper;

function snapshotOf(docs: { id: string; data: Record<string, unknown> }[]) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useFirestoreCollectionOnce', () => {
  it('fetches once via getDocs and maps docs to { ...data, id }', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([{ id: 's1', data: { name: 'Ada' } }]));

    const { result } = renderHook(() => useFirestoreCollectionOnce('staff'), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toEqual([{ name: 'Ada', id: 's1' }]);
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('does not fetch for an empty collection path', () => {
    renderHook(() => useFirestoreCollectionOnce(''), { wrapper });
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it('re-fetches when refresh() is called (no live listener)', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([{ id: 's1', data: { name: 'Ada' } }]));

    const { result } = renderHook(() => useFirestoreCollectionOnce('staff'), { wrapper });
    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });
    expect(mockGetDocs).toHaveBeenCalledTimes(1);

    result.current.refresh();
    await waitFor(() => {
      expect(mockGetDocs).toHaveBeenCalledTimes(2);
    });
  });

  it('mutate() transforms the cached rows without a refetch', async () => {
    mockGetDocs.mockResolvedValue(
      snapshotOf([
        { id: 's1', data: { name: 'Ada' } },
        { id: 's2', data: { name: 'Grace' } },
      ]),
    );

    const { result } = renderHook(() => useFirestoreCollectionOnce<{ name: string }>('staff'), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    act(() => {
      result.current.mutate((rows) =>
        rows.map((r) => (r.id === 's1' ? { ...r, name: 'Ada Lovelace' } : r)),
      );
    });

    // The cache notification may flush asynchronously — wait for the render.
    await waitFor(() => {
      expect(result.current.data).toEqual([
        { name: 'Ada Lovelace', id: 's1' },
        { name: 'Grace', id: 's2' },
      ]);
    });
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('mutate() is a no-op before the first fetch resolves', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    mockGetDocs.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(() => useFirestoreCollectionOnce<{ name: string }>('staff'), {
      wrapper,
    });
    const updater = vi.fn((rows: { name: string; id: string }[]) => rows);
    act(() => {
      result.current.mutate(updater);
    });
    expect(updater).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();

    resolveFetch(snapshotOf([{ id: 's1', data: { name: 'Ada' } }]));
    await waitFor(() => {
      expect(result.current.data).toEqual([{ name: 'Ada', id: 's1' }]);
    });
  });

  it('mutate() identity is stable across renders (safe useCallback dep)', async () => {
    mockGetDocs.mockResolvedValue(snapshotOf([{ id: 's1', data: { name: 'Ada' } }]));

    const { result, rerender } = renderHook(() => useFirestoreCollectionOnce('staff'), {
      wrapper,
    });
    await waitFor(() => {
      expect(result.current.data).not.toBeNull();
    });

    const firstMutate = result.current.mutate;
    rerender();
    expect(result.current.mutate).toBe(firstMutate);
  });
});
