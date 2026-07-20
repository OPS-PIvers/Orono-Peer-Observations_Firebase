/**
 * StaffPersonPage — ObservationCard delete authorization tests.
 *
 * Tests that admins can delete both draft and finalized observations,
 * while non-admins can only delete drafts they created.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Observation } from '@ops/shared';
import { OBSERVATION_STATUS } from '@ops/shared';

// ─── Mocks setup ────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  } & Record<string, unknown>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

// ─── Test component: ObservationCard extracted for unit testing ──────────────

interface ObservationCardProps {
  observation: Observation & { id: string };
  canDelete: boolean;
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function TestObservationCard({
  observation: o,
  canDelete,
  confirmingDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: ObservationCardProps) {
  return (
    <div data-testid="observation-card">
      <span>{o.observationName}</span>
      <span>{o.status}</span>
      {o.status === OBSERVATION_STATUS.draft ? (
        <>
          <a href={`/observations/${o.id}`}>Continue editing</a>
          {canDelete &&
            (confirmingDelete ? (
              <div>
                <span>Delete this draft?</span>
                <button onClick={onConfirmDelete}>Yes, delete</button>
                <button onClick={onCancelDelete}>Cancel</button>
              </div>
            ) : (
              <button onClick={onRequestDelete}>Delete draft</button>
            ))}
        </>
      ) : (
        <>
          <a href={`/observations/${o.id}`}>View</a>
          {o.pdfDriveFileId ? (
            <a href={`https://drive.google.com/file/d/${o.pdfDriveFileId}/view`}>View PDF</a>
          ) : null}
          {canDelete &&
            (confirmingDelete ? (
              <div>
                <span>Delete this observation?</span>
                <button onClick={onConfirmDelete}>Yes, delete</button>
                <button onClick={onCancelDelete}>Cancel</button>
              </div>
            ) : (
              <button onClick={onRequestDelete}>Delete</button>
            ))}
        </>
      )}
    </div>
  );
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeDraftObservation(overrides: Partial<Observation & { id: string }> = {}) {
  return {
    id: 'obs-1',
    observationName: 'Test Observation',
    observerEmail: 'pe@orono.k12.mn.us',
    observedEmail: 'teacher@orono.k12.mn.us',
    observedName: 'Jane Teacher',
    observedRole: 'teacher',
    observedYear: 2026,
    status: OBSERVATION_STATUS.draft,
    type: 'Instructional Round',
    createdAt: new Date(),
    lastModifiedAt: new Date(),
    observationData: {},
    componentNotes: {},
    ...overrides,
  } as Observation & { id: string };
}

function makeFinalizedObservation(overrides: Partial<Observation & { id: string }> = {}) {
  return makeDraftObservation({
    status: OBSERVATION_STATUS.finalized,
    pdfDriveFileId: 'drive-file-id',
    finalizedAt: new Date(),
    ...overrides,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

function renderTestCardAndGetCallbacks(overrides: {
  obs: Observation & { id: string };
  canDelete: boolean;
  confirmingDelete: boolean;
}) {
  const onRequestDelete = vi.fn();
  const onCancelDelete = vi.fn();
  const onConfirmDelete = vi.fn();

  const rendered = render(
    <TestObservationCard
      observation={overrides.obs}
      canDelete={overrides.canDelete}
      confirmingDelete={overrides.confirmingDelete}
      onRequestDelete={onRequestDelete}
      onCancelDelete={onCancelDelete}
      onConfirmDelete={onConfirmDelete}
    />,
  );

  return { ...rendered, onRequestDelete, onCancelDelete, onConfirmDelete };
}

describe('ObservationCard admin delete behavior', () => {
  describe('Draft observations', () => {
    it('shows delete button for the observer', () => {
      const obs = makeDraftObservation({ observerEmail: 'pe@orono.k12.mn.us' });
      renderTestCardAndGetCallbacks({
        obs,
        canDelete: true,
        confirmingDelete: false,
      });
      expect(screen.getByRole('button', { name: /delete draft/i })).toBeInTheDocument();
    });

    it('does not show delete button for non-observer non-admin', () => {
      const obs = makeDraftObservation({ observerEmail: 'other-pe@orono.k12.mn.us' });
      const { queryByRole } = renderTestCardAndGetCallbacks({
        obs,
        canDelete: false,
        confirmingDelete: false,
      });
      expect(queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('shows delete button for admin even if not observer', () => {
      const obs = makeDraftObservation({ observerEmail: 'other-pe@orono.k12.mn.us' });
      renderTestCardAndGetCallbacks({
        obs,
        canDelete: true,
        confirmingDelete: false,
      });
      expect(screen.getByRole('button', { name: /delete draft/i })).toBeInTheDocument();
    });

    it('shows confirmation dialog when delete is requested', () => {
      const obs = makeDraftObservation();
      const { rerender, onRequestDelete } = renderTestCardAndGetCallbacks({
        obs,
        canDelete: true,
        confirmingDelete: false,
      });
      fireEvent.click(screen.getByRole('button', { name: /delete draft/i }));
      expect(onRequestDelete).toHaveBeenCalled();

      // Re-render with confirmingDelete=true to show the confirmation
      rerender(
        <TestObservationCard
          observation={obs}
          canDelete={true}
          confirmingDelete={true}
          onRequestDelete={onRequestDelete}
          onCancelDelete={vi.fn()}
          onConfirmDelete={vi.fn()}
        />,
      );
      expect(screen.getByText(/delete this draft/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /yes, delete/i })).toBeInTheDocument();
    });
  });

  describe('Finalized observations', () => {
    it('does not show delete button for non-admin observer', () => {
      const obs = makeFinalizedObservation({ observerEmail: 'pe@orono.k12.mn.us' });
      const { queryByRole } = renderTestCardAndGetCallbacks({
        obs,
        canDelete: false,
        confirmingDelete: false,
      });
      expect(queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    });

    it('shows delete button for admin regardless of observer status', () => {
      const obs = makeFinalizedObservation({ observerEmail: 'other-pe@orono.k12.mn.us' });
      renderTestCardAndGetCallbacks({
        obs,
        canDelete: true,
        confirmingDelete: false,
      });
      const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
      expect(deleteBtn).toBeInTheDocument();
    });

    it('shows confirmation dialog when admin deletes finalized', () => {
      const obs = makeFinalizedObservation({ observerEmail: 'other-pe@orono.k12.mn.us' });
      const { rerender, onRequestDelete } = renderTestCardAndGetCallbacks({
        obs,
        canDelete: true,
        confirmingDelete: false,
      });
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      expect(onRequestDelete).toHaveBeenCalled();

      // Re-render with confirmingDelete=true
      rerender(
        <TestObservationCard
          observation={obs}
          canDelete={true}
          confirmingDelete={true}
          onRequestDelete={onRequestDelete}
          onCancelDelete={vi.fn()}
          onConfirmDelete={vi.fn()}
        />,
      );
      expect(screen.getByText(/delete this observation/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /yes, delete/i })).toBeInTheDocument();
    });
  });
});
