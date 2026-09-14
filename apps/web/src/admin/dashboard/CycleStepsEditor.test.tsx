/**
 * CycleStepsEditor — the completion-mode control. Picking a mode must land
 * on the step exactly as the save path validates and writes it, and a
 * manual step hides the done-event picker it no longer uses.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { dashboardStep, type DashboardStep } from '@ops/shared';
import { CycleStepsEditor } from './CycleStepsEditor';
import { validateSteps } from './dashboardValidation';

function Harness({
  initial,
  onChange,
}: {
  initial: DashboardStep[];
  onChange: (next: DashboardStep[]) => void;
}) {
  const [steps, setSteps] = useState(initial);
  return (
    <CycleStepsEditor
      value={steps}
      onChange={(next) => {
        setSteps(next);
        onChange(next);
      }}
    />
  );
}

describe('CycleStepsEditor — completion mode', () => {
  it('sets completionMode, hides "Mark it done" for manual, and the result saves', async () => {
    const onChange = vi.fn<(next: DashboardStep[]) => void>();
    render(
      <Harness
        initial={[dashboardStep.parse({ id: 'preObs', title: 'Planning', doneWhen: 'finalized' })]}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));

    const modeSelect = screen.getByLabelText('How it gets completed');
    expect(modeSelect).toHaveValue('auto');
    expect(screen.getByLabelText('Mark it done')).toBeInTheDocument();

    await userEvent.selectOptions(modeSelect, 'manual');
    const saved = onChange.mock.lastCall?.[0];
    expect(saved?.[0]?.completionMode).toBe('manual');
    // The ignored done event is kept, not cleared — switching back restores it.
    expect(saved?.[0]?.doneWhen).toBe('finalized');
    expect(screen.queryByLabelText('Mark it done')).not.toBeInTheDocument();
    expect(saved && validateSteps(saved)).toEqual([]);

    // Round-trip through the stored JSON shape.
    const reparsed = saved?.map((s) => dashboardStep.parse(JSON.parse(JSON.stringify(s))));
    expect(reparsed?.[0]?.completionMode).toBe('manual');

    await userEvent.selectOptions(modeSelect, 'either');
    expect(onChange.mock.lastCall?.[0][0]?.completionMode).toBe('either');
    expect(screen.getByLabelText('Mark it done')).toBeInTheDocument();
  });

  it('shows a legacy step with no completionMode as Automatic', async () => {
    const legacy = {
      ...dashboardStep.parse({ id: 'old', title: 'Old' }),
    } as Partial<DashboardStep>;
    delete legacy.completionMode;
    render(<Harness initial={[legacy as DashboardStep]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByLabelText('How it gets completed')).toHaveValue('auto');
  });

  it('rejects an invalid mode at save validation', () => {
    const bad = { ...dashboardStep.parse({ id: 'x' }), completionMode: 'sometimes' };
    expect(validateSteps([bad as unknown as DashboardStep])[0]?.field).toBe('completionMode');
  });
});
