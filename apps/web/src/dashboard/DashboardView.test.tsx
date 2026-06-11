import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CheckpointWithStatus } from './deriveCheckpoints';
import type { Staff } from '@ops/shared';
import { DashboardView } from './DashboardView';

describe('DashboardView (TaskRow disabled CTA buttons)', () => {
  // Helper to create a minimal checkpoint with customizable fields
  function makeCheckpoint(overrides: Partial<CheckpointWithStatus> = {}): CheckpointWithStatus {
    return {
      id: 'test-checkpoint',
      key: 'test-key',
      type: 'observation',
      typeLabel: 'Observation',
      title: 'Test Checkpoint',
      desc: 'A test checkpoint',
      monthLabel: 'Jan',
      dateLabel: 'Jan 1',
      dueRelative: '',
      cta: 'View Observation',
      ctaUrl: '',
      status: 'upcoming',
      completedLabel: null,
      percent: null,
      percentLabel: '',
      ...overrides,
    };
  }

  const defaultViewProps = {
    // DashboardView only reads `staff.summativeYear`; a partial fixture cast
    // through `unknown` keeps the test focused on the chrome under test.
    staff: { summativeYear: false } as unknown as Staff,
    firstName: 'John',
    yearTierLabel: 'Year 1',
    cycleYearLabel: '2025-26',
    cycleCloseLabel: 'May 31',
    sections: {
      hero: true,
      filterBar: true,
      quickMaterials: true,
      peerEvaluatorCard: true,
      progressSummary: true,
      roleChip: true,
      statBar: true,
      timeline: true,
    },
    quickMaterials: [],
    peerEvaluator: null,
    roleDisplayName: 'Teacher',
    buildingNames: ['Main Building'],
    moduleChips: [],
    readOnly: false,
  };

  it('renders nothing when status is not done, no ctaUrl exists, and cta label is empty', async () => {
    const tasks = [
      makeCheckpoint({
        id: 'empty-cta',
        status: 'upcoming',
        ctaUrl: '',
        cta: '',
      }),
    ];

    const { container } = render(<DashboardView {...defaultViewProps} tasks={tasks} />);

    // Expand the task
    const headerButton = container.querySelector('.task-row__header');
    if (headerButton) {
      await userEvent.click(headerButton);
    }

    // No CTA button should be rendered since cta is empty
    const ctaButtons = container.querySelectorAll('.task-row__cta');
    expect(ctaButtons).toHaveLength(0);
  });

  it('renders nothing for done checkpoints without ctaUrl', async () => {
    const tasks = [
      makeCheckpoint({
        id: 'done-no-cta',
        status: 'done',
        ctaUrl: '',
        cta: 'Some Button',
        completedLabel: 'Jan 1',
      }),
    ];

    const { container } = render(<DashboardView {...defaultViewProps} tasks={tasks} />);

    // Expand the task
    const headerButton = container.querySelector('.task-row__header');
    if (headerButton) {
      await userEvent.click(headerButton);
    }

    // No CTA button should render since status is done and no ctaUrl
    const ctaButtons = container.querySelectorAll('.task-row__cta');
    expect(ctaButtons).toHaveLength(0);
  });

  it('does not render button in readOnly mode when no ctaUrl exists', async () => {
    const tasks = [
      makeCheckpoint({
        id: 'readonly-test',
        status: 'upcoming',
        ctaUrl: '',
        cta: 'Test Button',
      }),
    ];

    const { container } = render(
      <DashboardView {...defaultViewProps} tasks={tasks} readOnly={true} />,
    );

    // Expand the task
    const headerButton = container.querySelector('.task-row__header');
    if (headerButton) {
      await userEvent.click(headerButton);
    }

    // In readOnly mode with no ctaUrl, CTA button should not render
    const ctaButtons = container.querySelectorAll('.task-row__cta');
    expect(ctaButtons).toHaveLength(0);
  });
});
