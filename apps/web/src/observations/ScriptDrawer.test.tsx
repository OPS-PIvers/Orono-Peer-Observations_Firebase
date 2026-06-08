import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ScriptDrawer } from './ScriptDrawer';

beforeEach(() => {
  sessionStorage.clear();
});

describe('ScriptDrawer keyboard support', () => {
  it('opens, then collapses via the keyboard handle', async () => {
    const user = userEvent.setup();
    render(
      <ScriptDrawer sidebarWidth={0}>
        <div data-testid="script-body">script content</div>
      </ScriptDrawer>,
    );

    // The handle is the only control while collapsed; match on its unique
    // "Press Enter…" phrasing so it doesn't collide with the collapse button.
    const handle = screen.getByRole('button', { name: /press enter/i });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('script-body')).not.toBeInTheDocument();

    handle.focus();
    await user.keyboard('{Enter}');
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('script-body')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('script-body')).not.toBeInTheDocument();
  });

  it('resizes with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <ScriptDrawer sidebarWidth={0}>
        <div data-testid="script-body">script content</div>
      </ScriptDrawer>,
    );
    const handle = screen.getByRole('button', { name: /press enter/i });
    handle.focus();

    // ArrowUp from collapsed grows the body so the content becomes visible.
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('script-body')).toBeInTheDocument();
    expect(handle).toHaveAttribute('aria-expanded', 'true');
  });
});
