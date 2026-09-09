import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyAudience, type Building, type DashboardQuickMaterial } from '@ops/shared';
import { DashboardPreview } from './DashboardPreview';
import type { AudienceOptions } from './audienceOptions';

/**
 * "Preview as": the sample staff member's five audience dimensions are
 * editable from the preview header, and the quick materials rail filters
 * through the same matcher the real dashboard uses.
 */

const now = new Date('2026-03-01T00:00:00Z');
const SECTIONS = {
  hero: false,
  roleChip: false,
  progressSummary: false,
  statBar: false,
  timeline: false,
  filterBar: false,
  quickMaterials: true,
  peerEvaluatorCard: false,
};
const OPTIONS: AudienceOptions = {
  roles: [],
  buildings: [
    { buildingId: 'oms', displayName: 'OMS', isActive: true, createdAt: now, updatedAt: now },
    {
      buildingId: 'high-school',
      displayName: 'High School',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ] as Building[],
  modules: [],
};

function material(label: string, audience = emptyAudience()): DashboardQuickMaterial {
  return { label, sub: '', icon: 'doc', url: '', audience };
}

beforeAll(() => {
  // jsdom has no ResizeObserver; the zoom frame only needs it to exist.
  globalThis.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});

describe('DashboardPreview "Preview as"', () => {
  it('filters materials as the persona changes, and hides the rail when nothing matches', async () => {
    const user = userEvent.setup();
    render(
      <DashboardPreview
        sections={SECTIONS}
        steps={[]}
        cycleCloseLabel="May 15"
        audienceOptions={OPTIONS}
        quickMaterials={[
          material('For everyone'),
          material('OMS only', { ...emptyAudience(), buildings: ['OMS'] }),
          material('Probationary only', { ...emptyAudience(), cycleStatuses: ['probationary'] }),
        ]}
      />,
    );
    // Default sample: year 2, High School, teacher.
    expect(screen.getByText('For everyone')).toBeInTheDocument();
    expect(screen.queryByText('OMS only')).toBeNull();
    expect(screen.queryByText('Probationary only')).toBeNull();

    await user.click(screen.getByRole('button', { name: /preview as/i }));
    const popover = await screen.findByTestId('preview-as-popover');
    expect(popover).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'OMS' }));
    expect(screen.getByText('OMS only')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Year'), '4');
    expect(screen.getByText(/Cycle phase/)).toHaveTextContent('Probationary');
    expect(screen.getByText('Probationary only')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reset sample/i }));
    expect(screen.queryByText('OMS only')).toBeNull();
    expect(screen.queryByText('Probationary only')).toBeNull();
  });

  it('renders no Quick materials card when the persona matches nothing', () => {
    render(
      <DashboardPreview
        sections={SECTIONS}
        steps={[]}
        cycleCloseLabel="May 15"
        audienceOptions={OPTIONS}
        quickMaterials={[material('OMS only', { ...emptyAudience(), buildings: ['OMS'] })]}
      />,
    );
    expect(screen.queryByText('Quick materials')).toBeNull();
  });
});
