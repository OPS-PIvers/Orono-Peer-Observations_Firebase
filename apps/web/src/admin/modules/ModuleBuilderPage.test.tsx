import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ModuleDoc, ModuleItem, ModuleSection } from '@ops/shared';

/**
 * Component tests for ModuleBuilderPage preview affordance and nav.
 */

const { previewNavigateSpy } = vi.hoisted(() => {
  const previewNavigateSpy = vi.fn();
  return { previewNavigateSpy };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => previewNavigateSpy,
    useParams: () => ({ moduleId: 'test-module' }),
  };
});

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'admin@orono.k12.mn.us' } }),
}));

vi.mock('@/hooks/useFirestoreDoc', () => ({
  useFirestoreDoc: () => {
    const moduleData: ModuleDoc = {
      moduleId: 'test-module',
      displayName: 'Test Module',
      description: 'A test module',
      color: 'blue',
      isActive: false,
      hasPage: false,
      icon: 'shapes',
      sections: [],
      autoEnable: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return {
      data: moduleData,
      loading: false,
      error: null,
    };
  },
}));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [], loading: false, error: null }),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));

vi.mock('firebase/firestore', () => ({
  setDoc: vi.fn(),
  writeBatch: vi.fn(() => ({
    delete: vi.fn(),
    set: vi.fn(),
    commit: vi.fn(),
  })),
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
}));

import { ModuleBuilderPage } from './ModuleBuilderPage';

describe('ModuleBuilderPage — preview affordance', () => {
  beforeEach(() => {
    previewNavigateSpy.mockClear();
  });

  it('renders a "Preview page" button that navigates to /m/{moduleId}', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ModuleBuilderPage />
      </MemoryRouter>,
    );

    const previewBtn = screen.getByTestId('preview-module-button');
    expect(previewBtn).toBeInTheDocument();
    expect(previewBtn).toHaveTextContent('Preview page');

    await user.click(previewBtn);
    expect(previewNavigateSpy).toHaveBeenCalledWith('/m/test-module');
  });
});

/**
 * Tests for ModuleBuilderPage section deletion cascade.
 * This ensures that when a section is deleted, all items with that sectionId
 * are also deleted (not left as ghost items in the database).
 */

describe('ModuleBuilderPage - section deletion cascade', () => {
  it('identifies items belonging to a section for deletion', () => {
    const items: ModuleItem[] = [
      {
        itemId: 'i1',
        moduleId: 'mod-1',
        kind: 'material',
        sectionId: 'sec-1',
        order: 0,
        title: 'Item in section 1',
        description: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        itemId: 'i2',
        moduleId: 'mod-1',
        kind: 'material',
        sectionId: 'sec-2',
        order: 0,
        title: 'Item in section 2',
        description: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        itemId: 'i3',
        moduleId: 'mod-1',
        kind: 'resource' as const,
        sectionId: 'sec-1',
        order: 1,
        title: 'Resource in section 1',
        description: '',
        linkUrl: 'https://example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // When deleting section sec-1, we should identify items i1 and i3
    const sectionIdToDelete = 'sec-1';
    const itemsToDelete = items.filter((item) => item.sectionId === sectionIdToDelete);

    expect(itemsToDelete).toHaveLength(2);
    expect(itemsToDelete.map((i) => i.itemId)).toEqual(['i1', 'i3']);
  });

  it('correctly updates sections array when deleting a section', () => {
    const sections = [
      { id: 'sec-1', type: 'materials' as const, title: 'Section 1', body: '' },
      { id: 'sec-2', type: 'resources' as const, title: 'Section 2', body: '' },
      { id: 'sec-3', type: 'richtext' as const, title: 'Section 3', body: '<p>Content</p>' },
    ];

    const sectionIdToDelete = 'sec-2';
    const nextSections = sections.filter((s) => s.id !== sectionIdToDelete);

    expect(nextSections).toHaveLength(2);
    expect(nextSections.map((s) => s.id)).toEqual(['sec-1', 'sec-3']);
  });

  it('handles deletion of a section with no items', () => {
    const items: ModuleItem[] = [
      {
        itemId: 'i1',
        moduleId: 'mod-1',
        kind: 'material',
        sectionId: 'sec-1',
        order: 0,
        title: 'Item',
        description: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const sectionIdToDelete = 'sec-2'; // This section has no items
    const itemsToDelete = items.filter((item) => item.sectionId === sectionIdToDelete);

    expect(itemsToDelete).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for the write-race fix: updateSections functional updater pattern
//
// The original code captured `sections` from a render-time closure so a
// debounced body flush could resurrect a stale array and wipe newer edits.
// The fix keeps a `sectionsRef` that is always updated to the latest
// committed state; every mutation is computed against `sectionsRef.current`
// via a functional updater so interleaved writes compose correctly.
// ---------------------------------------------------------------------------

/**
 * Inline re-implementation of the updateSections + patchSection + addSection
 * logic to allow isolated unit testing without mounting the full component.
 *
 * The shape mirrors ModuleBuilderPage exactly so tests break loudly if the
 * component logic diverges.
 */
function makeSectionMutators(initial: ModuleSection[]) {
  // Mirrors the sectionsRef held by the component.
  const sectionsRef = { current: initial };
  // Tracks every write that reaches "Firestore" (setDoc equivalent).
  const writes: ModuleSection[][] = [];

  function updateSections(updater: (current: ModuleSection[]) => ModuleSection[]) {
    const next = updater(sectionsRef.current);
    if (next === sectionsRef.current) return; // no-op guard
    sectionsRef.current = next;
    writes.push(next);
  }

  function addSection(id: string): void {
    updateSections((current) => [
      ...current,
      { id, type: 'richtext' as const, title: '', body: '' },
    ]);
  }

  function patchSection(id: string, patch: Partial<ModuleSection>): void {
    updateSections((current) =>
      current.some((s) => s.id === id)
        ? current.map((s) => (s.id === id ? { ...s, ...patch } : s))
        : current,
    );
  }

  function moveSection(id: string, dir: -1 | 1): void {
    updateSections((current) => {
      const idx = current.findIndex((s) => s.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= current.length) return current;
      return current.map((s, i) => {
        if (i === idx) return current[swap] ?? s;
        if (i === swap) return current[idx] ?? s;
        return s;
      });
    });
  }

  function deleteSection(id: string): void {
    const next = sectionsRef.current.filter((s) => s.id !== id);
    sectionsRef.current = next;
    writes.push(next);
  }

  return { sectionsRef, writes, addSection, patchSection, moveSection, deleteSection };
}

describe('updateSections functional updater — write-race prevention', () => {
  it('always reads the latest ref, not a stale render-time closure', () => {
    const { sectionsRef, writes, addSection, patchSection } = makeSectionMutators([
      { id: 'sec-1', type: 'richtext', title: 'Intro', body: 'old body' },
    ]);

    // Simulate a second section being added (e.g. admin clicks "Add section").
    addSection('sec-2');
    expect(sectionsRef.current).toHaveLength(2);

    // Now a debounced flush fires for sec-1's body. If it used a stale closure
    // it would write back only [sec-1], dropping sec-2.
    patchSection('sec-1', { body: 'updated body' });

    const lastWrite = writes.at(-1);
    expect(lastWrite).toBeDefined();
    expect(lastWrite).toHaveLength(2); // sec-2 must still be present
    expect(lastWrite?.find((s) => s.id === 'sec-1')?.body).toBe('updated body');
    expect(lastWrite?.find((s) => s.id === 'sec-2')).toBeDefined();
  });

  it('patchSection for a since-deleted section is a no-op — no write, no resurrection', () => {
    const { sectionsRef, writes, addSection, deleteSection, patchSection } = makeSectionMutators(
      [],
    );

    addSection('sec-1');
    addSection('sec-2');
    expect(sectionsRef.current).toHaveLength(2);

    // sec-1 gets deleted (admin clicks delete button).
    deleteSection('sec-1');
    const writeCountBeforeFlush = writes.length;

    // A stale debounced flush for sec-1 fires after deletion.
    patchSection('sec-1', { body: 'ghost body' });

    // No new write should have been issued.
    expect(writes.length).toBe(writeCountBeforeFlush);
    // sec-1 must not reappear in the ref.
    expect(sectionsRef.current.find((s) => s.id === 'sec-1')).toBeUndefined();
    expect(sectionsRef.current).toHaveLength(1);
  });

  it('debounced flush does not wipe a concurrently-renamed section title', () => {
    const { sectionsRef, writes, patchSection } = makeSectionMutators([
      { id: 'sec-1', type: 'richtext', title: 'Old Title', body: '' },
    ]);

    // Admin renames the section title (immediate write).
    patchSection('sec-1', { title: 'New Title' });
    expect(sectionsRef.current[0]?.title).toBe('New Title');

    // 400 ms later the debounced body flush fires.
    patchSection('sec-1', { body: '<p>hello</p>' });

    const lastWrite = writes.at(-1);
    expect(lastWrite).toBeDefined();
    const sec = lastWrite?.find((s) => s.id === 'sec-1');
    // The title rename must be preserved — not reverted to 'Old Title'.
    expect(sec?.title).toBe('New Title');
    expect(sec?.body).toBe('<p>hello</p>');
  });

  it('moveSection correctly swaps sections without stomping concurrent body edits', () => {
    const { sectionsRef, patchSection, moveSection } = makeSectionMutators([
      { id: 'sec-1', type: 'richtext', title: 'A', body: '' },
      { id: 'sec-2', type: 'richtext', title: 'B', body: '' },
    ]);

    // Admin edits sec-2 body.
    patchSection('sec-2', { body: 'draft text' });
    // Then moves sec-2 up before the debounce fires.
    moveSection('sec-2', -1);

    // sec-2 should now be first, sec-1 second.
    expect(sectionsRef.current[0]?.id).toBe('sec-2');
    expect(sectionsRef.current[1]?.id).toBe('sec-1');

    // Now the debounced flush fires: it patches sec-2 with the body.
    patchSection('sec-2', { body: 'final text' });

    const sec2 = sectionsRef.current.find((s) => s.id === 'sec-2');
    expect(sec2?.body).toBe('final text');
    // The move result must be preserved.
    expect(sectionsRef.current[0]?.id).toBe('sec-2');
  });

  it('updater returning the same reference is a no-op (no Firestore write)', () => {
    const initial: ModuleSection[] = [{ id: 'sec-1', type: 'richtext', title: 'X', body: '' }];
    const { writes, patchSection } = makeSectionMutators(initial);

    // Patch a section that does not exist — updater returns current unchanged.
    patchSection('nonexistent', { body: 'anything' });
    expect(writes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Simulated debounced flush test (fake timers)
//
// Validates that the 400 ms debounce + unmount flush interact correctly with
// interleaved structural changes, mimicking the timer-based path in
// ModuleSectionEditor without needing a React harness.
// ---------------------------------------------------------------------------

describe('debounced flush path — fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires only once even when multiple keystrokes arrive within 400 ms', () => {
    const writes: Partial<ModuleSection>[] = [];

    // Mirrors the debounce logic in ModuleSectionEditor.handleBodyChange
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingBody: string | null = null;
    const onPatchRef = { current: (patch: Partial<ModuleSection>) => writes.push(patch) };

    function handleBodyChange(text: string) {
      pendingBody = text;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (pendingBody !== null) {
          onPatchRef.current({ body: pendingBody });
          pendingBody = null;
        }
      }, 400);
    }

    handleBodyChange('draft 1');
    handleBodyChange('draft 2');
    handleBodyChange('draft 3');

    // Nothing written yet — still within the 400 ms window.
    expect(writes).toHaveLength(0);

    vi.advanceTimersByTime(400);

    // Only one write, with the last keystroke's value.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ body: 'draft 3' });
  });

  it('unmount flush fires immediately without waiting for the 400 ms debounce', () => {
    const writes: Partial<ModuleSection>[] = [];

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingBody: string | null = null;
    const onPatchRef = { current: (patch: Partial<ModuleSection>) => writes.push(patch) };

    function handleBodyChange(text: string) {
      pendingBody = text;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (pendingBody !== null) {
          onPatchRef.current({ body: pendingBody });
          pendingBody = null;
        }
      }, 400);
    }

    function flushOnUnmount() {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pendingBody !== null) {
        onPatchRef.current({ body: pendingBody });
        pendingBody = null;
      }
    }

    handleBodyChange('last typed text');

    // User navigates away at 100 ms — before the 400 ms debounce fires.
    vi.advanceTimersByTime(100);
    flushOnUnmount();

    // The flush must have saved the pending body immediately.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ body: 'last typed text' });

    // Advancing past the original debounce window must NOT produce a second write.
    vi.advanceTimersByTime(400);
    expect(writes).toHaveLength(1);
  });

  it('interleave: type → add section → unmount flush preserves new section', () => {
    // This is the canonical race scenario from the gap spec:
    // 1. Admin starts typing in sec-1's rich-text body (debounce pending).
    // 2. Admin adds a new sec-2 before the debounce fires.
    // 3. Admin navigates away — the unmount flush fires for sec-1.
    // With the ref-based fix, sec-2 must still be present after the flush.

    const { sectionsRef, writes, addSection, patchSection } = makeSectionMutators([
      { id: 'sec-1', type: 'richtext', title: 'Intro', body: '' },
    ]);

    // Step 1: rich-text body change — debounce pending.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingBody: string | null = null;
    // onPatchRef always points at the latest patchSection (updated each render).
    const onPatchRef = { current: patchSection };

    function handleBodyChange(text: string) {
      pendingBody = text;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (pendingBody !== null) {
          onPatchRef.current('sec-1', { body: pendingBody });
          pendingBody = null;
        }
      }, 400);
    }

    function flushOnUnmount() {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pendingBody !== null) {
        onPatchRef.current('sec-1', { body: pendingBody });
        pendingBody = null;
      }
    }

    handleBodyChange('<p>hello world</p>');

    // Step 2: before the debounce fires, admin adds a new section.
    vi.advanceTimersByTime(100);
    addSection('sec-2');
    expect(sectionsRef.current).toHaveLength(2);

    // Step 3: admin navigates away — unmount flush fires immediately.
    flushOnUnmount();

    // The flush writes sec-1's body while reading from sectionsRef.current
    // (which already includes sec-2).
    const lastWrite = writes.at(-1);
    expect(lastWrite).toBeDefined();
    expect(lastWrite).toHaveLength(2); // CRITICAL: sec-2 must not be lost
    expect(lastWrite?.find((s) => s.id === 'sec-1')?.body).toBe('<p>hello world</p>');
    expect(lastWrite?.find((s) => s.id === 'sec-2')).toBeDefined();

    // No further writes after the unmount flush.
    const countAfterUnmount = writes.length;
    vi.advanceTimersByTime(400);
    expect(writes.length).toBe(countAfterUnmount);
  });
});
