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
const { setDocMock, docHolder } = vi.hoisted(() => ({
  setDocMock: vi.fn<
    (
      ref: { path: string },
      payload: SavedRubricPayload,
      options: { merge: boolean },
    ) => Promise<void>
  >(() => Promise.resolve()),
  docHolder: { current: null as (Rubric & { id: string }) | null },
}));

vi.mock('firebase/firestore', () => ({
  setDoc: setDocMock,
  doc: (_db: unknown, path: string) => ({ path }),
  serverTimestamp: () => 'server-timestamp',
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
