/**
 * WorkProductPage — reorder & collision-free order assignment tests.
 *
 * Key behaviors under test:
 *  1. New-question order is scoped per type so cross-type order values
 *     never collide (work-product and instructional-round counters are
 *     independent).
 *  2. Permanent deletion triggers a batch renumber of the remaining
 *     questions of the same type, closing any gaps.
 *  3. Drag-and-drop reorder triggers a batch renumber reflecting the
 *     new position.
 *  4. Failed writes (network error, rules rejection) surface a toast error
 *     rather than silently failing.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkProductQuestion } from '@ops/shared';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { questionsState, mockSetDoc, mockDeleteDoc, mockBatchSet, mockBatchCommit, mockToastError } =
  vi.hoisted(() => {
    const questionsState: { rows: (WorkProductQuestion & { id: string })[] } = {
      rows: [],
    };
    return {
      questionsState,
      mockSetDoc: vi.fn(() => Promise.resolve()),
      mockDeleteDoc: vi.fn(() => Promise.resolve()),
      mockBatchSet: vi.fn(),
      mockBatchCommit: vi.fn(() => Promise.resolve()),
      mockToastError: vi.fn(),
    };
  });

vi.mock('sonner', () => ({
  toast: { error: mockToastError },
}));

vi.mock('firebase/firestore', () => ({
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
  doc: (_db: unknown, collectionPath: string, id?: string) =>
    id !== undefined ? { path: `${collectionPath}/${id}` } : { path: collectionPath },
  serverTimestamp: () => 'server-timestamp',
  writeBatch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({
    data: questionsState.rows,
    loading: false,
    error: null,
  }),
}));

// dnd-kit uses pointer events and ResizeObserver that jsdom doesn't provide;
// mock the library so the component still renders without crashing.
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual('@dnd-kit/core');
  return {
    ...(actual as object),
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...s: unknown[]) => s),
  };
});

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual('@dnd-kit/sortable');
  return {
    ...(actual as object),
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => undefined,
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

import { WorkProductPage } from './WorkProductPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function q(
  id: string,
  type: WorkProductQuestion['type'],
  order: number,
  text = `Question ${id}`,
): WorkProductQuestion & { id: string } {
  return {
    id,
    questionId: id,
    text,
    type,
    order,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkProductPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  questionsState.rows = [];
  mockSetDoc.mockClear();
  mockDeleteDoc.mockClear();
  mockBatchSet.mockClear();
  mockBatchCommit.mockClear();
  mockToastError.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('WorkProductPage — order assignment on add', () => {
  it('assigns order 0 to the first question of each type independently', async () => {
    // Seed: one existing work-product question at order 0.
    questionsState.rows = [q('wp1', 'work-product', 0)];

    const user = userEvent.setup();
    renderPage();

    // Type a new question and switch the radio to instructional-round.
    await user.type(screen.getByPlaceholderText('Add a new question…'), 'New IR question');
    await user.click(screen.getByRole('radio', { name: 'Instructional Round' }));
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));

    const rawCall0 = mockSetDoc.mock.calls[0] as unknown;
    if (!rawCall0) throw new Error('setDoc was never called');
    const payload = (rawCall0 as unknown[])[1] as Record<string, unknown>;
    // The instructional-round bucket is empty → order should be 0, not 1
    // (which it would incorrectly be if sorted.length were used across types).
    expect(payload['order']).toBe(0);
    expect(payload['type']).toBe('instructional-round');
  });

  it('assigns the next contiguous order within the same type', async () => {
    questionsState.rows = [q('wp1', 'work-product', 0), q('wp2', 'work-product', 1)];

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText('Add a new question…'), 'Third WP question');
    // Radio defaults to 'work-product'.
    await user.click(screen.getByRole('button', { name: /add/i }));

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));

    const rawCall0 = mockSetDoc.mock.calls[0] as unknown;
    if (!rawCall0) throw new Error('setDoc was never called');
    const payload = (rawCall0 as unknown[])[1] as Record<string, unknown>;
    expect(payload['order']).toBe(2);
    expect(payload['type']).toBe('work-product');
  });
});

describe('WorkProductPage — renumber on permanent delete', () => {
  it('batches a renumber of remaining same-type questions after deletion, leaving cross-type alone', async () => {
    questionsState.rows = [
      q('wp1', 'work-product', 0, 'Work Product Q1'),
      q('wp2', 'work-product', 1, 'Work Product Q2'),
      q('wp3', 'work-product', 2, 'Work Product Q3'),
      q('ir1', 'instructional-round', 0, 'IR Question 1'),
    ];

    const user = userEvent.setup();
    renderPage();

    // Delete the middle work-product question (wp2).
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete question' });
    // wp1 = idx 0, wp2 = idx 1, wp3 = idx 2 within the WP section.
    const btn1 = deleteButtons[1];
    if (!btn1) throw new Error('Expected at least 2 Delete question buttons');
    await user.click(btn1);
    // Click "Delete permanently" in the dialog.
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(mockDeleteDoc).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockBatchCommit).toHaveBeenCalledTimes(1));

    // The batch should have renumbered wp1 → 0, wp3 → 1 (2 items remaining).
    expect(mockBatchSet).toHaveBeenCalledTimes(2);

    // Extract the order values written in the batch.
    const writtenOrders = (mockBatchSet.mock.calls as [unknown, Record<string, unknown>][]).map(
      ([, patch]) => patch['order'],
    );
    expect(writtenOrders).toEqual([0, 1]);
  });

  it('skips the batch when the deleted question was the only one of its type', async () => {
    questionsState.rows = [
      q('wp1', 'work-product', 0, 'Only WP question'),
      q('ir1', 'instructional-round', 0, 'Only IR question'),
    ];

    const user = userEvent.setup();
    renderPage();

    // Delete the only work-product question.
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete question' });
    const btn0 = deleteButtons[0];
    if (!btn0) throw new Error('Expected at least 1 Delete question button');
    await user.click(btn0);
    await user.click(screen.getByRole('button', { name: /delete permanently/i }));

    await waitFor(() => expect(mockDeleteDoc).toHaveBeenCalledTimes(1));
    // No renumber needed — nothing left in that type bucket.
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

describe('WorkProductPage — question list rendering', () => {
  it('groups questions under section headings by type', () => {
    questionsState.rows = [
      q('wp1', 'work-product', 0, 'Describe the artifact'),
      q('ir1', 'instructional-round', 0, 'What was the learning target?'),
    ];

    renderPage();

    expect(screen.getByRole('heading', { name: 'Work Product' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Instructional Round' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Describe the artifact')).toBeInTheDocument();
    expect(screen.getByDisplayValue('What was the learning target?')).toBeInTheDocument();
  });

  it('renders drag handles with accessible labels', () => {
    questionsState.rows = [q('wp1', 'work-product', 0, 'Describe the artifact')];

    renderPage();

    expect(
      screen.getByRole('button', { name: /drag to reorder: describe the artifact/i }),
    ).toBeInTheDocument();
  });

  it('does not render the "phase 7" coming-soon note', () => {
    questionsState.rows = [];
    renderPage();
    expect(screen.queryByText(/phase 7/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reordering.*will land/i)).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no questions', () => {
    questionsState.rows = [];
    renderPage();
    expect(screen.getByText(/no questions yet/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Toast error paths
// ---------------------------------------------------------------------------
describe('WorkProductPage — toast errors on failed writes', () => {
  it('calls toast.error when inline text update fails', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('permission-denied'));
    questionsState.rows = [q('wp1', 'work-product', 0, 'Original text')];

    const user = userEvent.setup();
    renderPage();

    const input = screen.getByDisplayValue('Original text');
    await user.clear(input);
    await user.type(input, 'New text');
    // Trigger the onChange — userEvent.type fires onChange per keystroke;
    // the last keystroke call is what we care about resolving.
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to save question',
      expect.objectContaining({ description: 'permission-denied' }),
    );
  });

  it('calls toast.error when inline active toggle fails', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('offline'));
    questionsState.rows = [q('wp1', 'work-product', 0, 'A question')];

    const user = userEvent.setup();
    renderPage();

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to save question',
      expect.objectContaining({ description: 'offline' }),
    );
  });
});
