import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SignupFieldAnswer } from '@ops/shared';
import { SignupDetailsCard } from './SignupDetailsCard';

// Stub slotTime so tests don't depend on system locale / timezone.
vi.mock('@/scheduling/slotTime', () => ({
  formatLocalDateTime: (v: unknown) => (v ? 'Mon, Jan 6, 9:00 AM' : ''),
  formatLocalTime: (v: unknown) => (v ? '9:50 AM' : ''),
  toDate: (v: unknown) => {
    if (!v) return null;
    if (v instanceof Date) return v;
    return new Date('2026-01-06T15:50:00Z');
  },
}));

const START = new Date('2026-01-06T15:00:00Z');
const END = new Date('2026-01-06T15:50:00Z');

const ANSWERS: SignupFieldAnswer[] = [
  { fieldId: 'lesson-topic', type: 'select', value: 'Algebra – quadratics' },
  { fieldId: 'period', type: 'period-picker', value: 'Period 3' },
];

describe('SignupDetailsCard', () => {
  it('renders the card header', () => {
    render(<SignupDetailsCard scheduledStartAt={START} scheduledEndAt={END} signupDetails={[]} />);
    expect(screen.getByRole('heading', { name: 'Booking Details' })).toBeInTheDocument();
  });

  it('shows the formatted scheduled time range', () => {
    render(<SignupDetailsCard scheduledStartAt={START} scheduledEndAt={END} signupDetails={[]} />);
    // The time label combines formatLocalDateTime(start) + formatLocalTime(end)
    expect(screen.getByText(/Mon, Jan 6, 9:00 AM/)).toBeInTheDocument();
  });

  it('shows "Scheduled time" label', () => {
    render(<SignupDetailsCard scheduledStartAt={START} scheduledEndAt={END} signupDetails={[]} />);
    expect(screen.getByText('Scheduled time')).toBeInTheDocument();
  });

  it('does not render the sign-up details section when signupDetails is empty', () => {
    render(<SignupDetailsCard scheduledStartAt={START} scheduledEndAt={END} signupDetails={[]} />);
    expect(screen.queryByText('Sign-up details')).not.toBeInTheDocument();
  });

  it('renders each signup answer field when answers are present', () => {
    render(
      <SignupDetailsCard scheduledStartAt={START} scheduledEndAt={END} signupDetails={ANSWERS} />,
    );
    expect(screen.getByText('Sign-up details')).toBeInTheDocument();
    expect(screen.getByText('Algebra – quadratics')).toBeInTheDocument();
    expect(screen.getByText('Period 3')).toBeInTheDocument();
  });

  it('renders "—" for a blank answer value', () => {
    const answers: SignupFieldAnswer[] = [{ fieldId: 'notes', type: 'select', value: '' }];
    render(
      <SignupDetailsCard scheduledStartAt={START} scheduledEndAt={END} signupDetails={answers} />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders "—" as time label when scheduledStartAt is null', () => {
    render(<SignupDetailsCard scheduledStartAt={null} scheduledEndAt={null} signupDetails={[]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
