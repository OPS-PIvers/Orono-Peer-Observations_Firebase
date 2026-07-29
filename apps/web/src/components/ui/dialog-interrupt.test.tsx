/**
 * The interrupt slot every DialogContent/SheetContent renders. Its whole job
 * is to put an app-level alert (PLAT-09's session-timeout warning) inside the
 * ONE modal layer the user is actually looking at.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from './dialog';
import { DialogInterruptProvider, useHasOpenDialogLayer } from './dialog-interrupt';

function LayerProbe() {
  return <div data-testid="layer-open">{String(useHasOpenDialogLayer())}</div>;
}

function Harness() {
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <DialogInterruptProvider
      content={<div role="alert">Your session will expire in 4 minutes.</div>}
    >
      <LayerProbe />
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Outer</DialogTitle>
          <button type="button" onClick={() => setInnerOpen(true)}>
            Open inner
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={innerOpen} onOpenChange={setInnerOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Inner</DialogTitle>
          <button type="button" onClick={() => setInnerOpen(false)}>
            Close inner
          </button>
        </DialogContent>
      </Dialog>
    </DialogInterruptProvider>
  );
}

describe('DialogInterruptSlot', () => {
  it('renders the interrupt inside the open dialog and reports the open layer', async () => {
    render(<Harness />);

    expect(await screen.findByTestId('layer-open')).toHaveTextContent('true');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(screen.getByRole('alert'));
  });

  it('renders it only in the topmost of stacked dialogs, and follows the stack', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(await screen.findByRole('button', { name: 'Open inner' }));

    // Exactly one copy, in the layer the user is actually looking at.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(screen.getByText('Inner').closest('[role="dialog"]')).toContainElement(
      alerts[0] ?? null,
    );

    // Closing the top layer hands the interrupt back to the one underneath —
    // it must never disappear just because a dialog was dismissed.
    await user.click(screen.getByRole('button', { name: 'Close inner' }));

    const remaining = await screen.findAllByRole('alert');
    expect(remaining).toHaveLength(1);
    expect(screen.getByText('Outer').closest('[role="dialog"]')).toContainElement(
      remaining[0] ?? null,
    );
  });

  it('renders nothing when there is no interrupt', () => {
    render(
      <DialogInterruptProvider content={null}>
        <LayerProbe />
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Finalize</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogInterruptProvider>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports no open layer when every dialog is closed', () => {
    render(
      <DialogInterruptProvider content={null}>
        <LayerProbe />
      </DialogInterruptProvider>,
    );

    expect(screen.getByTestId('layer-open')).toHaveTextContent('false');
  });
});
