import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rubric, RubricDomain } from '@ops/shared';

interface SavedRubricPayload {
  rubricId: string;
  displayName: string;
  domains: RubricDomain[];
  updatedAt: unknown;
}

// Hoisted so the vi.mock factories below (which Vitest lifts to the top of
// the file) can reference them without hitting the TDZ.
const { setDocMock, writeBatchMock, docHolder, rolesHolder, mappingsHolder } = vi.hoisted(() => {
  interface Role {
    id: string;
    rubricId: string;
    displayName: string;
    roleId: string;
  }

  interface Mapping {
    id: string;
    roleId: string;
    year: number;
    assignedComponentIds: string[];
  }

  const createMockBatch = () => ({
    set: vi.fn(),
    commit: vi.fn(() => Promise.resolve()),
  });
  const writeBatchMock = vi.fn<() => ReturnType<typeof createMockBatch>>(createMockBatch);

  return {
    setDocMock: vi.fn<
      (
        ref: { path: string },
        payload: SavedRubricPayload,
        options: { merge: boolean },
      ) => Promise<void>
    >(() => Promise.resolve()),
    writeBatchMock,
    docHolder: { current: null as (Rubric & { id: string }) | null },
    rolesHolder: { current: null as Role[] | null },
    mappingsHolder: { current: null as Mapping[] | null },
  };
});

vi.mock('firebase/firestore', () => ({
  setDoc: setDocMock,
  doc: (_db: unknown, path: string) => ({ path }),
  serverTimestamp: () => 'server-timestamp',
  writeBatch: writeBatchMock,
}));

// Mock all of '@/lib/firebase' so RubricRow's module-level httpsCallable
// (imported via the RubricGrid constants) doesn't trigger a real Firebase
// initialization during tests.
vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: () => ({ data: docHolder.current, loading: false, error: null }),
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string) => {
    if (path === 'roles') {
      return { data: rolesHolder.current, loading: false, error: null };
    }
    if (path === 'roleYearMappings') {
      return { data: mappingsHolder.current, loading: false, error: null };
    }
    return { data: null, loading: false, error: null };
  },
}));

// useHydratedDraft calls the callback once per key change, not on every
// render. Replicate that behaviour with a ref so the draft is populated
// without an infinite-render loop.
vi.mock('@/hooks/useHydratedDraft', async () => {
  const { useRef, useEffect } = await import('react');
  return {
    useHydratedDraft: (key: string | null, data: unknown, cb: (d: unknown) => void) => {
      const hydratedKey = useRef<string | null>(null);
      useEffect(() => {
        if (key !== null && key !== hydratedKey.current && data) {
          hydratedKey.current = key;
          cb(data);
        }
      }, [key, data, cb]);
    },
  };
});

// useUnsavedChangesGuard registers a beforeunload guard — no-op in tests.
vi.mock('@/hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => undefined,
}));

import { RubricEditorPage } from './RubricEditorPage';

/** Component 1a carries an explicit color override; 1b uses the auto color. */
function makeRubricDoc(): Rubric & { id: string } {
  return {
    id: 'teacher',
    rubricId: 'teacher',
    displayName: 'Teacher Rubric',
    domains: [
      {
        id: '1',
        name: 'Planning & Preparation',
        components: [
          {
            id: '1a',
            title: 'Knowledge of content',
            proficiencyLevels: { developing: 'd', basic: 'b', proficient: 'p', distinguished: 'x' },
            lookFors: [],
            color: { bg: '#112233', fg: '#ffffff' },
          },
          {
            id: '1b',
            title: 'Knowing students',
            proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
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
  docHolder.current = makeRubricDoc();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/rubrics/teacher']}>
      <Routes>
        <Route path="/admin/rubrics/:rubricId" element={<RubricEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Walk the save payload and report the path of every `undefined` own value —
 *  Firestore rejects writes containing any of them. */
function collectUndefinedPaths(value: unknown, path: string): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== 'object') return [];
  if (value instanceof Date) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, i) => collectUndefinedPaths(item, `${path}[${i}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectUndefinedPaths(child, `${path}.${key}`),
  );
}

async function saveRubric(user: ReturnType<typeof userEvent.setup>): Promise<SavedRubricPayload> {
  await user.click(screen.getByRole('button', { name: 'Save rubric' }));
  await waitFor(() => {
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });
  const call = setDocMock.mock.calls.at(0);
  if (!call) throw new Error('setDoc was never called');
  const [ref, payload, options] = call;
  expect(ref).toEqual({ path: 'rubrics/teacher' });
  expect(options).toEqual({ merge: true });
  return payload;
}

describe('RubricEditorPage color reset', () => {
  it('saves cleanly after Reset — the color key is removed, not written as undefined', async () => {
    const user = userEvent.setup();
    renderPage();

    // 1a is the only component with an explicit override, so it owns the
    // only Reset button. After resetting, the row falls back to "auto".
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();

    const payload = await saveRubric(user);

    const componentA = payload.domains[0]?.components[0];
    if (!componentA) throw new Error('component 1a missing from save payload');
    expect('color' in componentA).toBe(false);
    expect(collectUndefinedPaths(payload, 'payload')).toEqual([]);
  });

  it('preserves an explicit color override on save', async () => {
    const user = userEvent.setup();
    renderPage();

    // Dirty the draft without touching colors.
    await user.type(screen.getByDisplayValue('Knowledge of content'), '!');

    const payload = await saveRubric(user);

    const componentA = payload.domains[0]?.components[0];
    if (!componentA) throw new Error('component 1a missing from save payload');
    expect(componentA.title).toBe('Knowledge of content!');
    expect(componentA.color).toEqual({ bg: '#112233', fg: '#ffffff' });
    expect(collectUndefinedPaths(payload, 'payload')).toEqual([]);
  });

  it('strips a stale color: undefined from components the edit never touched', async () => {
    // Simulate a draft hydrated from a doc that already carries an own
    // `color: undefined` property on 1b (the pre-fix Reset behavior).
    const doc = makeRubricDoc();
    const domain = doc.domains[0];
    const componentB = domain?.components[1];
    if (!domain || !componentB) throw new Error('fixture missing component 1b');
    domain.components[1] = { ...componentB, color: undefined };
    docHolder.current = doc;

    const user = userEvent.setup();
    renderPage();

    // Edit 1a only — 1b reaches save() untouched by updateComponent.
    await user.type(screen.getByDisplayValue('Knowledge of content'), '!');

    const payload = await saveRubric(user);

    const savedB = payload.domains[0]?.components[1];
    if (!savedB) throw new Error('component 1b missing from save payload');
    expect('color' in savedB).toBe(false);
    expect(collectUndefinedPaths(payload, 'payload')).toEqual([]);
  });
});

describe('RubricEditorPage component IDs', () => {
  it('appends the next free letter when the domain has no ID gaps', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add component' }));
    expect(screen.getByText('Component 1c')).toBeInTheDocument();

    const payload = await saveRubric(user);
    expect(payload.domains[0]?.components.map((c) => c.id)).toEqual(['1a', '1b', '1c']);
  });

  it('fills the ID gap left by a deleted component instead of re-minting an existing ID', async () => {
    // [1a, 1b, 1c] — deleting 1b leaves a gap; a length-derived ID would
    // mint a second "1c".
    const doc = makeRubricDoc();
    const domain = doc.domains[0];
    if (!domain) throw new Error('fixture missing domain 1');
    domain.components.push({
      id: '1c',
      title: 'Setting outcomes',
      proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
      lookFors: [],
    });
    docHolder.current = doc;

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Delete component 1b' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));
    expect(screen.queryByText('Component 1b')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add component' }));
    expect(screen.getByText('Component 1b')).toBeInTheDocument();

    const payload = await saveRubric(user);
    expect(payload.domains[0]?.components.map((c) => c.id)).toEqual(['1a', '1c', '1b']);
    const added = payload.domains[0]?.components[2];
    expect(added?.title).toBe('New component');
  });

  it('refuses to save a rubric with duplicate component IDs', async () => {
    // Simulate bad imported data: two components sharing the ID "1a".
    const doc = makeRubricDoc();
    const domain = doc.domains[0];
    const componentB = domain?.components[1];
    if (!domain || !componentB) throw new Error('fixture missing component 1b');
    domain.components[1] = { ...componentB, id: '1a' };
    docHolder.current = doc;

    const user = userEvent.setup();
    renderPage();

    // Dirty the draft so the Save button enables.
    await user.type(screen.getByDisplayValue('Knowledge of content'), '!');
    await user.click(screen.getByRole('button', { name: 'Save rubric' }));

    expect(await screen.findByText(/duplicate component ID \(1a\)/)).toBeInTheDocument();
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('RubricEditorPage schema validation', () => {
  it('refuses to save a rubric with an empty component title', async () => {
    const user = userEvent.setup();
    renderPage();

    // Clear the title of component 1a
    const titleInput = screen.getByDisplayValue('Knowledge of content');
    await user.tripleClick(titleInput);
    await user.keyboard('[Backspace]');

    await user.click(screen.getByRole('button', { name: 'Save rubric' }));

    expect(await screen.findByText(/Component.*title/i)).toBeInTheDocument();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('removes empty domains at save time', async () => {
    const user = userEvent.setup();
    renderPage();

    // Add a new domain (which starts with zero components)
    await user.click(screen.getByRole('button', { name: 'Add domain' }));

    // Make a dirty change so we can save
    const titleInput = screen.getByDisplayValue('Knowledge of content');
    await user.type(titleInput, 'x');

    // Save should succeed after pruning the empty domain
    const payload = await saveRubric(user);
    expect(payload.domains.length).toBe(1); // Only domain 1 remains (empty domain was pruned)
  });

  it('displays validation errors in the save error banner', async () => {
    const user = userEvent.setup();
    renderPage();

    // Create an error
    const titleInput = screen.getByDisplayValue('Knowledge of content');
    await user.tripleClick(titleInput);
    await user.keyboard('[Backspace]');

    await user.click(screen.getByRole('button', { name: 'Save rubric' }));

    // The error should appear in the existing saveError banner
    const errorBanner = await screen.findByText(/Component.*title/i);
    expect(errorBanner).toBeInTheDocument();
    // Verify setDoc was not called, meaning the validation blocked the save
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

// ── Multi-domain fixture ─────────────────────────────────────────────────────

function makeTwoDomainRubricDoc(): Rubric & { id: string } {
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
            proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
            lookFors: [],
          },
          {
            id: '1b',
            title: 'Knowing students',
            proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
            lookFors: [],
          },
        ],
      },
      {
        id: '2',
        name: 'Classroom Environment',
        components: [
          {
            id: '2a',
            title: 'Classroom culture',
            proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
            lookFors: [],
          },
        ],
      },
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('RubricEditorPage displayName editing', () => {
  it('saves with the updated display name after editing the title input', async () => {
    const user = userEvent.setup();
    renderPage();

    // The display-name input is pre-filled with 'Teacher Rubric'
    const nameInput = screen.getByDisplayValue('Teacher Rubric');
    // Select-all and type replacement text
    await user.tripleClick(nameInput);
    await user.keyboard('[Backspace]');
    await user.type(nameInput, 'Updated Name');

    const payload = await saveRubric(user);
    expect(payload.displayName).toBe('Updated Name');
  });
});

describe('RubricEditorPage domain deletion', () => {
  beforeEach(() => {
    docHolder.current = makeTwoDomainRubricDoc();
  });

  it('deletes a domain after clicking Yes in the confirmation strip', async () => {
    const user = userEvent.setup();
    renderPage();

    // Click delete on domain 2
    await user.click(screen.getByRole('button', { name: 'Delete domain 2' }));
    // Confirmation strip appears — click yes
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    // Domain 2 header should be gone
    expect(screen.queryByDisplayValue('Classroom Environment')).not.toBeInTheDocument();

    // Save to confirm the write excludes domain 2
    const payload = await saveRubric(user);
    expect(payload.domains.map((d) => d.id)).toEqual(['1']);
  });

  it('cancels domain deletion when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Delete domain 2' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Domain 2 should still be visible
    expect(screen.getByDisplayValue('Classroom Environment')).toBeInTheDocument();
  });
});

describe('RubricEditorPage reordering', () => {
  beforeEach(() => {
    docHolder.current = makeTwoDomainRubricDoc();
  });

  it('moves domain 2 above domain 1 using the move-up button, persisting order on save', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Move domain 2 up' }));

    const payload = await saveRubric(user);
    // After moving domain 2 up, the save order should be [2, 1]
    expect(payload.domains.map((d) => d.id)).toEqual(['2', '1']);
  });

  it('moves component 1a down within domain 1, persisting order on save', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Move component 1a down' }));

    const payload = await saveRubric(user);
    const domain1 = payload.domains.find((d) => d.id === '1');
    expect(domain1?.components.map((c) => c.id)).toEqual(['1b', '1a']);
  });

  it('move-up is disabled for the first domain', () => {
    renderPage();

    const moveUpDomain1 = screen.getByRole('button', { name: 'Move domain 1 up' });
    expect(moveUpDomain1).toBeDisabled();
  });

  it('move-down is disabled for the last component in a domain', () => {
    renderPage();

    const moveDownLast = screen.getByRole('button', { name: 'Move component 1b down' });
    expect(moveDownLast).toBeDisabled();
  });
});

describe('RubricEditorPage roleYearMappings pruning', () => {
  beforeEach(() => {
    docHolder.current = makeTwoDomainRubricDoc();
    // Set up roles and mappings with component assignments
    rolesHolder.current = [
      { id: 'teacher-id', rubricId: 'teacher', displayName: 'Teacher', roleId: 'teacher' },
    ];
    mappingsHolder.current = [
      {
        id: 'teacher-1',
        roleId: 'teacher',
        year: 1,
        assignedComponentIds: ['1a', '1b', '2a'],
      },
      {
        id: 'teacher-2',
        roleId: 'teacher',
        year: 2,
        assignedComponentIds: ['1a', '2a'],
      },
    ];
    writeBatchMock.mockClear();
  });

  it('prunes deleted component IDs from roleYearMappings when saving a rubric with deleted components', async () => {
    const user = userEvent.setup();
    renderPage();

    // Delete component 2a
    await user.click(screen.getByRole('button', { name: 'Delete component 2a' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    const payload = await saveRubric(user);

    // Verify the rubric save succeeded and domain 2 was pruned (it had no components after deletion)
    expect(payload.domains.map((d) => d.id)).toEqual(['1']);

    // Verify writeBatch was called to update mappings
    expect(writeBatchMock).toHaveBeenCalled();
  });

  it('does not call writeBatch when no components are deleted', async () => {
    const user = userEvent.setup();
    renderPage();

    // Just edit a title without deleting
    await user.type(screen.getByDisplayValue('Knowledge of content'), '!');

    await saveRubric(user);

    // writeBatch should not have been called since no deletions occurred
    expect(writeBatchMock).not.toHaveBeenCalled();
  });

  it('does not call writeBatch when there are no roles using this rubric', async () => {
    rolesHolder.current = []; // No roles use this rubric
    const user = userEvent.setup();
    renderPage();

    // Delete component 2a
    await user.click(screen.getByRole('button', { name: 'Delete component 2a' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await saveRubric(user);

    // writeBatch should not be called if there are no roles to update
    expect(writeBatchMock).not.toHaveBeenCalled();
  });

  it('does not call writeBatch when all mappings have no deleted component IDs', async () => {
    // Set up mappings that don't contain component 2a
    mappingsHolder.current = [
      {
        id: 'teacher-1',
        roleId: 'teacher',
        year: 1,
        assignedComponentIds: ['1a', '1b'],
      },
    ];
    const user = userEvent.setup();
    renderPage();

    // Delete component 2a
    await user.click(screen.getByRole('button', { name: 'Delete component 2a' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await saveRubric(user);

    // writeBatch should not be called since no mappings actually contain 2a
    expect(writeBatchMock).not.toHaveBeenCalled();
  });
});
