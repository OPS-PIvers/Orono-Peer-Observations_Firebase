import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SaveStatusIndicator } from './GlobalToolsBar';

// `<OfflineIndicator>` (mounted app-wide by `<Layout>`) is the single source
// of truth for announcing "you're offline". SaveStatusIndicator must only
// report save/retry state and must never assert offline-ness itself, or the
// observation editor ends up showing two contradictory notices at once.
describe('SaveStatusIndicator', () => {
  it('shows a retry message without the word "offline" when offline mid-save', () => {
    render(<SaveStatusIndicator state="saving" error={null} isOnline={false} />);

    const text = screen.getByText(/will retry when reconnected/i);
    expect(text).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('shows a retry message without the word "offline" when a save failed while offline', () => {
    render(<SaveStatusIndicator state="error" error="network error" isOnline={false} />);

    const text = screen.getByText(/will retry when reconnected/i);
    expect(text).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('falls back to the normal error message when online', () => {
    render(<SaveStatusIndicator state="error" error="network error" isOnline={true} />);

    expect(screen.getByText(/save failed: network error/i)).toBeInTheDocument();
  });
});
