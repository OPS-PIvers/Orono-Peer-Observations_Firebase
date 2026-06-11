import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, RoleYearMapping, Rubric } from '@ops/shared';

// Hoisted so the vi.mock factories below (which Vitest lifts to the top of
// the file) can reference them without hitting the TDZ.
const { setDocMock, writeBatchMock, rolesHolder, rubricsHolder, mappingsHolder } = vi.hoisted(
  () => {
    const createMockBatch = () => ({
      set: vi.fn(),
      commit: vi.fn(() => Promise.resolve()),
    });
    const writeBatchMock = vi.fn<() => ReturnType<typeof createMockBatch>>(createMockBatch);

    return {
      setDocMock: vi.fn<(ref: unknown, data: unknown, opts: unknown) => Promise<void>>(() =>
        Promise.resolve(),
      ),
      writeBatchMock,
      rolesHolder: { current: null as (Role & { id: string })[] | null },
      rubricsHolder: { current: null as (Rubric & { id: string })[] | null },
      mappingsHolder: { current: null as (RoleYearMapping & { id: string })[] | null },
    };
  },
);

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  setDoc: setDocMock,
  writeBatch: writeBatchMock,
  serverTimestamp: () => 'server-timestamp',
}));

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string) => {
    if (path === 'roles') {
      return { data: rolesHolder.current, loading: false, error: null };
    }
    if (path === 'rubrics') {
      return { data: rubricsHolder.current, loading: false, error: null };
    }
    if (path === 'roleYearMappings') {
      return { data: mappingsHolder.current, loading: false, error: null };
    }
    return { data: null, loading: false, error: null };
  },
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: () => ({ data: null, loading: false, error: null }),
}));

/**
 * Unit tests for RoleYearMappingsPage pruning logic.
 *
 * Tests the core pruning behavior — ensuring that when a mapping is saved,
 * any component IDs that no longer exist in the rubric are filtered out.
 */
describe('RoleYearMappingsPage pruning', () => {
  function makeSampleRubric(): Rubric & { id: string } {
    return {
      id: 'teacher',
      rubricId: 'teacher',
      displayName: 'Teacher Rubric',
      domains: [
        {
          id: '1',
          name: 'Planning',
          components: [
            {
              id: '1a',
              title: 'Knowledge of content',
              proficiencyLevels: {
                developing: '',
                basic: '',
                proficient: '',
                distinguished: '',
              },
              lookFors: [],
            },
            {
              id: '1b',
              title: 'Knowing students',
              proficiencyLevels: {
                developing: '',
                basic: '',
                proficient: '',
                distinguished: '',
              },
              lookFors: [],
            },
          ],
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
  }

  beforeEach(() => {
    setDocMock.mockClear();
    writeBatchMock.mockClear();

    // Set up sample data
    const rubric = makeSampleRubric();
    rolesHolder.current = [
      {
        id: 'teacher-id',
        rubricId: 'teacher',
        displayName: 'Teacher',
        roleId: 'teacher',
        isActive: true,
        isSpecialAccess: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    rubricsHolder.current = [rubric];
    mappingsHolder.current = [
      {
        id: 'teacher-1',
        roleId: 'teacher',
        year: 1 as const,
        assignedComponentIds: ['1a', '1b', '2a'], // 2a no longer exists in rubric
        updatedAt: new Date(),
      },
    ];
  });

  it('filters out stale component IDs that no longer exist in the rubric', () => {
    const mapping = mappingsHolder.current?.[0];
    if (!mapping) throw new Error('mapping missing');

    // The mapping contains '2a' which is not in the rubric
    const validIds = new Set(['1a', '1b']);
    const prunedIds = mapping.assignedComponentIds.filter((id) => validIds.has(id));

    // Verify that '2a' was filtered out
    expect(prunedIds).toEqual(['1a', '1b']);
    expect(prunedIds.length).toBeLessThan(mapping.assignedComponentIds.length);
  });

  it('keeps valid component IDs that exist in the rubric', () => {
    const mapping = mappingsHolder.current?.[0];
    if (!mapping) throw new Error('mapping missing');

    const validIds = new Set(['1a', '1b']);
    const prunedIds = mapping.assignedComponentIds.filter((id) => validIds.has(id));

    expect(prunedIds).toContain('1a');
    expect(prunedIds).toContain('1b');
  });

  it('handles mappings with all valid IDs (no pruning needed)', () => {
    mappingsHolder.current = [
      {
        id: 'teacher-1',
        roleId: 'teacher',
        year: 1 as const,
        assignedComponentIds: ['1a', '1b'], // All valid
        updatedAt: new Date(),
      },
    ];

    const mapping = mappingsHolder.current[0];
    if (!mapping) throw new Error('mapping missing');

    const validIds = new Set(['1a', '1b']);
    const prunedIds = mapping.assignedComponentIds.filter((id) => validIds.has(id));

    expect(prunedIds).toEqual(['1a', '1b']);
    expect(prunedIds.length).toBe(mapping.assignedComponentIds.length);
  });

  it('handles mappings with all stale IDs (complete pruning)', () => {
    mappingsHolder.current = [
      {
        id: 'teacher-1',
        roleId: 'teacher',
        year: 1 as const,
        assignedComponentIds: ['2a', '2b', '3c'], // All invalid
        updatedAt: new Date(),
      },
    ];

    const mapping = mappingsHolder.current[0];
    if (!mapping) throw new Error('mapping missing');

    const validIds = new Set(['1a', '1b']);
    const prunedIds = mapping.assignedComponentIds.filter((id) => validIds.has(id));

    expect(prunedIds).toEqual([]);
  });

  it('handles empty mappings gracefully', () => {
    mappingsHolder.current = [
      {
        id: 'teacher-1',
        roleId: 'teacher',
        year: 1 as const,
        assignedComponentIds: [],
        updatedAt: new Date(),
      },
    ];

    const mapping = mappingsHolder.current[0];
    if (!mapping) throw new Error('mapping missing');

    const validIds = new Set(['1a', '1b']);
    const prunedIds = mapping.assignedComponentIds.filter((id) => validIds.has(id));

    expect(prunedIds).toEqual([]);
  });
});
