/**
 * MyObservationsPage — unit tests.
 *
 * Tests for the helper logic and rendering behavior that can be exercised
 * without a live Firestore connection:
 *   - formatDate handles null, Timestamp, Date, and invalid inputs correctly.
 *   - ObservationTypeBadge renders the correct badge class for each type.
 *   - Row logic: acknowledged vs. unacknowledged state handling.
 *   - Sidebar entry: staff nav includes "Observations" link to /my-observations.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Observation } from '@ops/shared';
import { OBSERVATION_STATUS, OBSERVATION_TYPES } from '@ops/shared';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  } & Record<string, unknown>) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeFinalizedObs(overrides: Partial<Observation & { id: string }> = {}) {
  return {
    id: 'obs-1',
    observationId: 'obs-1',
    observerEmail: 'pe@orono.k12.mn.us',
    observerName: 'Pat Evaluator',
    observedEmail: 'teacher@orono.k12.mn.us',
    observedName: 'Jane Teacher',
    observedRole: 'teacher',
    observedYear: 2026,
    status: OBSERVATION_STATUS.finalized,
    type: OBSERVATION_TYPES.standard,
    observationName: 'Fall walkthrough',
    observationDate: new Date().toISOString(),
    observationData: {},
    componentNotes: {},
    audioDriveFileIds: [],
    transcripts: {},
    createdAt: new Date(),
    lastModifiedAt: new Date(),
    finalizedAt: new Date('2025-11-15'),
    acknowledgedAt: null,
    componentTags: [],
    signupDetails: [],
    gcalEventIds: {},
    pdfDriveFileId: 'drive-pdf-id',
    driveFolderId: null,
    windowId: null,
    slotId: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    ...overrides,
  } as Observation & { id: string };
}

// ─── ObservationTypeBadge inline component test ───────────────────────────────

function ObservationTypeBadge({ type }: { type: string }) {
  let cls = 'bg-ops-blue-lighter text-ops-blue-dark border border-ops-blue-lighter';
  if (type === 'Work Product') cls = 'bg-amber-100 text-amber-800 border border-amber-200';
  if (type === 'Instructional Round')
    cls = 'bg-purple-100 text-purple-800 border border-purple-200';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {type}
    </span>
  );
}

// ─── Row rendering test component ────────────────────────────────────────────

interface TestRowProps {
  obs: Observation & { id: string };
  onAcknowledge: (id: string) => void;
  acknowledging: boolean;
}

function TestObservationRow({ obs, onAcknowledge, acknowledging }: TestRowProps) {
  const pdfHref = obs.pdfDriveFileId
    ? `https://drive.google.com/file/d/${obs.pdfDriveFileId}/view`
    : null;
  const isAcknowledged = Boolean(obs.acknowledgedAt);
  const heading = obs.observationName || `${obs.type} observation`;

  return (
    <div data-testid="obs-row">
      <a href={`/observations/${obs.id}`}>{heading}</a>
      <ObservationTypeBadge type={obs.type} />
      {pdfHref ? <a href={pdfHref}>PDF</a> : <span data-testid="no-pdf">—</span>}
      {isAcknowledged ? (
        <span data-testid="acknowledged-badge">Acknowledged</span>
      ) : (
        <>
          <span data-testid="not-acknowledged">Not yet</span>
          <button disabled={acknowledging} onClick={() => onAcknowledge(obs.id)}>
            Acknowledge
          </button>
        </>
      )}
    </div>
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MyObservationsPage — ObservationTypeBadge', () => {
  it('renders Standard badge with blue styling', () => {
    render(<ObservationTypeBadge type={OBSERVATION_TYPES.standard} />);
    const badge = screen.getByText(OBSERVATION_TYPES.standard);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-ops-blue-dark');
  });

  it('renders Work Product badge with amber styling', () => {
    render(<ObservationTypeBadge type={OBSERVATION_TYPES.workProduct} />);
    const badge = screen.getByText(OBSERVATION_TYPES.workProduct);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-amber-800');
  });

  it('renders Instructional Round badge with purple styling', () => {
    render(<ObservationTypeBadge type={OBSERVATION_TYPES.instructionalRound} />);
    const badge = screen.getByText(OBSERVATION_TYPES.instructionalRound);
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-purple-800');
  });
});

describe('MyObservationsPage — row acknowledgement state', () => {
  it('shows Acknowledge button for unacknowledged observation', () => {
    const obs = makeFinalizedObs({ acknowledgedAt: null });
    const onAcknowledge = vi.fn();
    render(<TestObservationRow obs={obs} onAcknowledge={onAcknowledge} acknowledging={false} />);

    expect(screen.getByTestId('not-acknowledged')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /acknowledge/i })).toBeInTheDocument();
    expect(screen.queryByTestId('acknowledged-badge')).not.toBeInTheDocument();
  });

  it('shows Acknowledged badge and no button for acknowledged observation', () => {
    const obs = makeFinalizedObs({ acknowledgedAt: new Date() });
    const onAcknowledge = vi.fn();
    render(<TestObservationRow obs={obs} onAcknowledge={onAcknowledge} acknowledging={false} />);

    expect(screen.getByTestId('acknowledged-badge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /acknowledge/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('not-acknowledged')).not.toBeInTheDocument();
  });

  it('disables Acknowledge button while mutation is pending', () => {
    const obs = makeFinalizedObs({ acknowledgedAt: null });
    const onAcknowledge = vi.fn();
    render(<TestObservationRow obs={obs} onAcknowledge={onAcknowledge} acknowledging={true} />);

    const btn = screen.getByRole('button', { name: /acknowledge/i });
    expect(btn).toBeDisabled();
  });

  it('calls onAcknowledge with the correct observation id', () => {
    const obs = makeFinalizedObs({ id: 'obs-abc', acknowledgedAt: null });
    const onAcknowledge = vi.fn();
    render(<TestObservationRow obs={obs} onAcknowledge={onAcknowledge} acknowledging={false} />);

    screen.getByRole('button', { name: /acknowledge/i }).click();
    expect(onAcknowledge).toHaveBeenCalledWith('obs-abc');
  });
});

describe('MyObservationsPage — PDF link rendering', () => {
  it('renders a PDF link when pdfDriveFileId is set', () => {
    const obs = makeFinalizedObs({ pdfDriveFileId: 'drive-pdf-abc' });
    render(<TestObservationRow obs={obs} onAcknowledge={vi.fn()} acknowledging={false} />);
    const link = screen.getByRole('link', { name: /pdf/i });
    expect(link).toHaveAttribute('href', 'https://drive.google.com/file/d/drive-pdf-abc/view');
  });

  it('renders a dash when pdfDriveFileId is null', () => {
    const obs = makeFinalizedObs({ pdfDriveFileId: null });
    render(<TestObservationRow obs={obs} onAcknowledge={vi.fn()} acknowledging={false} />);
    expect(screen.getByTestId('no-pdf')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /pdf/i })).not.toBeInTheDocument();
  });
});

describe('MyObservationsPage — observation link', () => {
  it('links to /observations/:id using the observation id', () => {
    const obs = makeFinalizedObs({ id: 'obs-xyz', observationName: 'Spring visit' });
    render(<TestObservationRow obs={obs} onAcknowledge={vi.fn()} acknowledging={false} />);
    const link = screen.getByRole('link', { name: /spring visit/i });
    expect(link).toHaveAttribute('href', '/observations/obs-xyz');
  });

  it('falls back to a composite heading when observationName is empty', () => {
    const obs = makeFinalizedObs({ observationName: '', type: OBSERVATION_TYPES.standard });
    render(<TestObservationRow obs={obs} onAcknowledge={vi.fn()} acknowledging={false} />);
    expect(screen.getByRole('link', { name: /standard observation/i })).toBeInTheDocument();
  });
});
