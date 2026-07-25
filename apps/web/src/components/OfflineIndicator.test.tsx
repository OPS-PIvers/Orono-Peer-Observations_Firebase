import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factory below (which Vitest lifts to the top of
// the file) can reference it without hitting the TDZ.
const { useOnlineStatusMock } = vi.hoisted(() => ({
  useOnlineStatusMock: vi.fn<() => boolean>(),
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: useOnlineStatusMock,
}));

import { OfflineIndicator } from './OfflineIndicator';

beforeEach(() => {
  useOnlineStatusMock.mockReset();
});

describe('OfflineIndicator', () => {
  it('renders an empty live region while online', () => {
    useOnlineStatusMock.mockReturnValue(true);
    render(<OfflineIndicator />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('shows the offline message inside a polite live region when offline', () => {
    useOnlineStatusMock.mockReturnValue(false);
    render(<OfflineIndicator />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('You’re offline — changes may not save.');
  });

  it('offers no dismiss affordance', () => {
    useOnlineStatusMock.mockReturnValue(false);
    render(<OfflineIndicator />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('clears itself on the next render once connectivity returns', () => {
    useOnlineStatusMock.mockReturnValue(false);
    const { rerender } = render(<OfflineIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline — changes may not save.');

    useOnlineStatusMock.mockReturnValue(true);
    rerender(<OfflineIndicator />);

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
