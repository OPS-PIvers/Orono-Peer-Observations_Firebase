import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_VISIBILITY_HIDDEN } from '@ops/shared';

const { mockCallable } = vi.hoisted(() => ({
  mockCallable: vi.fn<(input: unknown) => Promise<unknown>>(() =>
    Promise.resolve({ data: { ok: true } }),
  ),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
vi.mock('@/lib/firebase', () => ({ auth: {}, db: {}, storage: {}, functions: {} }));
vi.mock('@/dev/viewAsGuard', () => ({ assertWritable: vi.fn() }));
vi.mock('./CoObserversSection', () => ({ CoObserversSection: () => null }));

import { SharingPopover } from './SharingPopover';

const coObservers = {
  ownerEmail: 'pe@orono.k12.mn.us',
  observedEmail: 't@orono.k12.mn.us',
  value: [],
};

function renderPopover(value = DRAFT_VISIBILITY_HIDDEN) {
  const props = { observationId: 'obs-1', coObservers };
  const view = render(<SharingPopover {...props} value={value} />);
  fireEvent.click(screen.getByRole('button', { name: /^Sharing:/ }));
  return {
    rerender: (next: typeof value) => {
      view.rerender(<SharingPopover {...props} value={next} />);
    },
  };
}

const notesSwitch = () => screen.getByRole('switch', { name: /Component notes/ });

beforeEach(() => {
  mockCallable.mockClear();
  mockCallable.mockImplementation(() => Promise.resolve({ data: { ok: true } }));
});

describe('SharingPopover', () => {
  it('saves one switch through the setDraftVisibility callable', async () => {
    const { rerender } = renderPopover();
    await act(async () => {
      fireEvent.click(notesSwitch());
      await Promise.resolve();
    });
    expect(mockCallable).toHaveBeenCalledWith({
      observationId: 'obs-1',
      key: 'notes',
      value: true,
    });

    // Held on (and disabled) until the live doc shows the change...
    expect(notesSwitch()).toBeChecked();
    expect(notesSwitch()).toBeDisabled();

    // ...then follows the live value again.
    rerender({ ...DRAFT_VISIBILITY_HIDDEN, notes: true });
    expect(notesSwitch()).toBeChecked();
    expect(notesSwitch()).toBeEnabled();
  });

  it('puts the switch back and shows the error when the save fails', async () => {
    mockCallable.mockImplementation(() => Promise.reject(new Error('permission-denied')));
    renderPopover();
    await act(async () => {
      fireEvent.click(notesSwitch());
      await Promise.resolve();
    });
    expect(notesSwitch()).not.toBeChecked();
    expect(notesSwitch()).toBeEnabled();
    expect(screen.getByText(/Could not update sharing: permission-denied/)).toBeInTheDocument();
  });
});
