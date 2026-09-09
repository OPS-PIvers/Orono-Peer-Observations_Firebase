import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockGetDocs, mockWhere } = vi.hoisted(() => ({
  mockGetDocs: vi.fn(),
  mockWhere: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collectionGroup: vi.fn((_db: unknown, id: string) => ({ kind: 'collectionGroup', id })),
  query: vi.fn((...args: unknown[]) => ({ kind: 'query', args })),
  where: mockWhere,
  getDocs: mockGetDocs,
}));

import { useAssignedModuleMaterials } from './useAssignedModuleMaterials';

function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const wrapper = Wrapper;

function materialDoc(moduleId: string, itemId: string) {
  return { data: () => ({ moduleId, itemId, kind: 'material', title: `${moduleId}/${itemId}` }) };
}

interface FakeQueryArg {
  field?: string;
  op?: string;
  value?: unknown;
}

/** The `in`-clause values of a query built by the `firebase/firestore` mock. */
function inValuesOf(q: unknown): string[] {
  const clause = (q as { args: FakeQueryArg[] }).args.find((a) => a.op === 'in');
  return Array.isArray(clause?.value) ? (clause.value as string[]) : [];
}

/** The `in` values of the query the Nth getDocs call was handed. */
function inValuesOfCall(call: number): string[] {
  return inValuesOf(mockGetDocs.mock.calls[call]?.[0]);
}

/** Answer each batched query with one material per module in that batch. */
function respondPerBatch() {
  mockGetDocs.mockImplementation((q: unknown) =>
    Promise.resolve({ docs: inValuesOf(q).map((id) => materialDoc(id, 'i1')) }),
  );
}

function moduleIds(count: number, prefix = 'm'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useAssignedModuleMaterials', () => {
  it('does not query when the module list is empty', () => {
    const { result } = renderHook(() => useAssignedModuleMaterials([]), { wrapper });
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.materials).toEqual([]);
  });

  it('runs a single query for 30 or fewer modules', async () => {
    const ids = moduleIds(30);
    mockGetDocs.mockResolvedValue({ docs: ids.map((id) => materialDoc(id, 'i1')) });

    const { result } = renderHook(() => useAssignedModuleMaterials(ids), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(inValuesOfCall(0)).toEqual(ids);
    expect(result.current.materials).toHaveLength(30);
  });

  it('batches past the 30-value `in` limit and merges every batch', async () => {
    const ids = moduleIds(31);
    respondPerBatch();

    const { result } = renderHook(() => useAssignedModuleMaterials(ids), { wrapper });

    await waitFor(() => {
      expect(result.current.materials).toHaveLength(31);
    });
    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    expect([...inValuesOfCall(0), ...inValuesOfCall(1)]).toEqual(ids);
    // The 31st module's material — the one the old `.slice(0, 30)` dropped.
    expect(result.current.materials.map((m) => m.moduleId)).toContain('m030');
  });

  it('covers every module when a staff member has far more than 30', async () => {
    const ids = moduleIds(95);
    respondPerBatch();

    const { result } = renderHook(() => useAssignedModuleMaterials(ids), { wrapper });

    await waitFor(() => {
      expect(result.current.materials).toHaveLength(95);
    });
    expect(mockGetDocs).toHaveBeenCalledTimes(4);
    expect(new Set(result.current.materials.map((m) => m.moduleId))).toEqual(new Set(ids));
  });

  it('filters to material items and de-duplicates by module + item id', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [materialDoc('m1', 'i1'), materialDoc('m1', 'i1'), materialDoc('m1', 'i2')],
    });

    const { result } = renderHook(() => useAssignedModuleMaterials(['m1']), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.materials).toHaveLength(2);
    expect(mockWhere).toHaveBeenCalledWith('kind', '==', 'material');
  });

  it('shares one fetch across renders that pass the same ids in a different order', async () => {
    mockGetDocs.mockResolvedValue({ docs: [materialDoc('a', 'i1')] });

    const { result, rerender } = renderHook(({ ids }) => useAssignedModuleMaterials(ids), {
      wrapper,
      initialProps: { ids: ['b', 'a'] },
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    rerender({ ids: ['a', 'b'] });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
  });

  it('surfaces a query failure as an error instead of empty materials', async () => {
    mockGetDocs.mockRejectedValue(new Error('permission-denied'));

    const { result } = renderHook(() => useAssignedModuleMaterials(['m1']), { wrapper });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error?.message).toBe('permission-denied');
    expect(result.current.materials).toEqual([]);
  });
});
