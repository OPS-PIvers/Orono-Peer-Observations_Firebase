import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PageErrorBoundary } from './ErrorBoundary';

const childRenders = vi.fn();

function Boom(): never {
  childRenders();
  throw new Error('render exploded');
}

beforeEach(() => {
  childRenders.mockClear();
  // React logs caught render errors and the boundary logs its own. Neither is
  // signal here.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageErrorBoundary', () => {
  it('shows a recoverable fallback instead of unmounting the tree', () => {
    render(
      <MemoryRouter>
        <PageErrorBoundary>
          <Boom />
        </PageErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('re-attempts the render when the user retries', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <PageErrorBoundary>
          <Boom />
        </PageErrorBoundary>
      </MemoryRouter>,
    );
    const rendersBeforeRetry = childRenders.mock.calls.length;

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(childRenders.mock.calls.length).toBeGreaterThan(rendersBeforeRetry);
    // Still broken, so the fallback comes back rather than a blank page.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <MemoryRouter>
        <PageErrorBoundary>
          <p>page content</p>
        </PageErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
