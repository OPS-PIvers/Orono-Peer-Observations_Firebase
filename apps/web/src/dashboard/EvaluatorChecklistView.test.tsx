import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CheckpointWithStatus } from './deriveCheckpoints';
import {
  EvaluatorChecklistView,
  checklistAction,
  observationTypeForWatchedKind,
  type EvaluatorChecklistViewProps,
} from './EvaluatorChecklistView';

function task(partial: Partial<CheckpointWithStatus>): CheckpointWithStatus {
  return {
    id: 'preObs',
    key: 'preObs',
    type: 'meeting',
    typeLabel: 'Planning',
    title: 'Planning',
    desc: '',
    monthLabel: '',
    dateLabel: '',
    rawDate: null,
    dateSource: 'none',
    scheduledStartAt: null,
    scheduledEndAt: null,
    dueRelative: '',
    cta: '',
    ctaUrl: '',
    status: 'soon',
    urgent: false,
    completedLabel: null,
    percent: null,
    percentLabel: '',
    completionMode: 'manual',
    checkScope: 'observation',
    watchedKind: 'anyDraftFirst',
    observationId: 'obs-1',
    autoDone: false,
    visibleToStaff: true,
    checkedBy: null,
    checkedByName: null,
    checkedAt: null,
    ...partial,
  };
}

function renderView(props: Partial<EvaluatorChecklistViewProps>) {
  const onToggle = vi.fn();
  const onStart = vi.fn();
  render(
    <EvaluatorChecklistView
      tasks={[]}
      pendingId={null}
      errors={{}}
      newObservationsDisabled={false}
      canCreateObservations
      onToggle={onToggle}
      onStart={onStart}
      {...props}
    />,
  );
  return { onToggle, onStart };
}

describe('checklistAction', () => {
  const opts = { newObservationsDisabled: false, canCreateObservations: true };
  it('keeps auto steps read-only', () => {
    expect(checklistAction(task({ completionMode: 'auto' }), opts)).toBe('auto');
  });
  it('toggles manual/either steps with somewhere to store the check', () => {
    expect(checklistAction(task({ completionMode: 'either' }), opts)).toBe('toggle');
    expect(checklistAction(task({ checkScope: 'staff', observationId: null }), opts)).toBe(
      'toggle',
    );
  });
  it('offers to start an observation when an observation-tied step has none', () => {
    expect(checklistAction(task({ observationId: null }), opts)).toBe('start');
    expect(
      checklistAction(task({ observationId: null }), { ...opts, newObservationsDisabled: true }),
    ).toBe('creationDisabled');
    expect(
      checklistAction(task({ observationId: null, watchedKind: 'standardFinalized' }), opts),
    ).toBe('needsFinalized');
  });
  it("doesn't offer to start one when the viewer's role can't observe", () => {
    expect(
      checklistAction(task({ observationId: null }), { ...opts, canCreateObservations: false }),
    ).toBe('observerOnly');
  });
});

describe('observationTypeForWatchedKind', () => {
  it('creates the type the watched kind resolves to', () => {
    expect(observationTypeForWatchedKind('workProduct')).toBe('Work Product');
    expect(observationTypeForWatchedKind('instructionalRound')).toBe('Instructional Round');
    expect(observationTypeForWatchedKind('anyDraftFirst')).toBe('Standard');
  });
});

describe('EvaluatorChecklistView', () => {
  it('renders an unchecked manual step as a keyboard-operable toggle', async () => {
    const t = task({});
    const { onToggle } = renderView({ tasks: [t] });
    const toggle = screen.getByRole('button', { name: 'Mark complete: Planning' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    toggle.focus();
    await userEvent.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledWith(t);
  });

  it('shows a checked step as pressed with its attribution', () => {
    renderView({
      tasks: [
        task({
          status: 'done',
          checkedBy: 'pe@orono.k12.mn.us',
          checkedByName: 'Pat Evaluator',
          checkedAt: new Date('2026-02-20T15:00:00'),
        }),
      ],
    });
    expect(screen.getByRole('button', { name: 'Mark complete: Planning' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByText(/Marked complete by Pat Evaluator on Feb 20, 2026/),
    ).toBeInTheDocument();
  });

  it('renders auto steps read-only', () => {
    renderView({ tasks: [task({ completionMode: 'auto' })] });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Automatic')).toBeInTheDocument();
  });

  it('offers "Start observation & mark … done" when there is no observation', async () => {
    const t = task({ observationId: null });
    const { onStart } = renderView({ tasks: [t] });
    await userEvent.click(
      screen.getByRole('button', { name: 'Start observation & mark Planning done' }),
    );
    expect(onStart).toHaveBeenCalledWith(t);
  });

  it('shows pending and error states', () => {
    renderView({
      tasks: [task({}), task({ id: 'postObs', key: 'postObs', title: 'Reflection' })],
      pendingId: 'preObs',
      errors: { postObs: 'Only peer evaluators and administrators can check off steps.' },
    });
    const pending = screen.getByRole('button', { name: 'Mark complete: Planning' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending).toHaveTextContent('Saving…');
    expect(screen.getByRole('alert')).toHaveTextContent('Only peer evaluators');
    expect(
      screen.getByRole('button', { name: 'Mark complete: Reflection' }),
    ).toHaveAccessibleDescription('Only peer evaluators and administrators can check off steps.');
  });
});
