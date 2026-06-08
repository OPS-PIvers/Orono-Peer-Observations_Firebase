import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the Firebase SDK surface so the helper can run without a real
// Firestore. `where`/`query`/`collectionGroup` are pure descriptor factories;
// only `getDocs` needs a controllable return value. The `mock`-prefixed name
// lets vitest's hoisted `vi.mock` factory reference it.
const { mockGetDocs } = vi.hoisted(() => ({ mockGetDocs: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collectionGroup: vi.fn(() => ({ kind: 'collectionGroup' })),
  query: vi.fn((...constraints: unknown[]) => ({ kind: 'query', constraints })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  getDocs: mockGetDocs,
}));

import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import { fetchModuleMaterials } from './moduleMaterials';

afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchModuleMaterials', () => {
  it('returns [] without querying for an empty id list (no invalid `in []`)', async () => {
    const result = await fetchModuleMaterials([]);
    expect(result).toEqual([]);
    expect(getDocs).not.toHaveBeenCalled();
  });

  it('queries the items collection-group filtered by kind + moduleId and maps the docs', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({ itemId: 'a' }) }, { data: () => ({ itemId: 'b' }) }],
    });

    const result = await fetchModuleMaterials(['m1', 'm2']);

    expect(collectionGroup).toHaveBeenCalledWith(expect.anything(), 'items');
    expect(where).toHaveBeenCalledWith('kind', '==', 'material');
    expect(where).toHaveBeenCalledWith('moduleId', 'in', ['m1', 'm2']);
    expect(query).toHaveBeenCalledTimes(1);
    expect(getDocs).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ itemId: 'a' }, { itemId: 'b' }]);
  });
});
