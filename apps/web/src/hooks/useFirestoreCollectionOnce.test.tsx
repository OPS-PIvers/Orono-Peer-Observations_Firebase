import { type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockGetDocs } = vi.hoisted(() => ({ mockGetDocs: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ kind: 'collection' })),
  query: vi.fn((...args: unknown[]) => ({ kind: 'query', args })),
  getDocs: mockGetDocs,
}));

import { useFirestoreCollectionOnce } from './useFirestoreCollectionOnce';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

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
});
