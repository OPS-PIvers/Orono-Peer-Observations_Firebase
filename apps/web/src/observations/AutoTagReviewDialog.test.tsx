import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AutoTagReviewDialog, type AutoTagSuggestion } from './AutoTagReviewDialog';

const SUGGESTIONS: AutoTagSuggestion[] = [
  {
    paragraphIndex: 0,
    text: 'turned and talked',
    componentId: '1a',
    componentTitle: 'Knowledge of Content',
    paragraphText: 'Students turned and talked about the prompt.',
  },
  {
    paragraphIndex: 1,
    text: 'circulated',
    componentId: '2b',
    componentTitle: 'Culture for Learning',
    paragraphText: 'The teacher circulated during work time.',
  },
];

const COLORS = new Map([
  ['1a', { bg: '#dbeafe', fg: '#1e3a8a' }],
  ['2b', { bg: '#dcfce7', fg: '#14532d' }],
]);

function renderDialog(over: Partial<Parameters<typeof AutoTagReviewDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  render(
    <AutoTagReviewDialog
      open
      suggestions={SUGGESTIONS}
      colorById={COLORS}
      skippedCount={0}
      applying={false}
      error={null}
      onCancel={onCancel}
      onApply={onApply}
      {...over}
    />,
  );
  return { onApply, onCancel };
}

describe('AutoTagReviewDialog', () => {
  it('starts with every suggestion accepted and shows its source paragraph', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: /apply 2 tags/i })).toBeEnabled();
    expect(screen.getByText('Knowledge of Content')).toBeInTheDocument();

    // The source paragraph is shown with the proposed span highlighted, so the
    // text is split across the surrounding nodes and the <mark>.
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Students turned and talked about the prompt.');
    expect(rows[0]?.querySelector('mark')?.textContent).toBe('turned and talked');
  });

  it('sends only the kept subset when one suggestion is rejected', async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog();

    await user.click(screen.getByRole('checkbox', { name: /tag "circulated" as 2b/i }));
    await user.click(screen.getByRole('button', { name: /apply 1 tag$/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]?.[0]).toEqual([SUGGESTIONS[0]]);
  });

  it('rejects everything with the header checkbox and disables Apply', async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog();

    await user.click(screen.getByRole('checkbox', { name: /accept all/i }));

    expect(screen.getByRole('button', { name: /apply 0 tags/i })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('re-accepts everything on a second header-checkbox click', async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog();
    const acceptAll = screen.getByRole('checkbox', { name: /accept all/i });

    await user.click(acceptAll);
    await user.click(acceptAll);
    await user.click(screen.getByRole('button', { name: /apply 2 tags/i }));

    expect(onApply.mock.calls[0]?.[0]).toEqual(SUGGESTIONS);
  });

  it('explains suggestions the server already discarded', () => {
    renderDialog({ skippedCount: 3 });
    expect(screen.getByText(/3 further suggestions were discarded/i)).toBeInTheDocument();
  });

  it('surfaces an apply error without closing', () => {
    renderDialog({ error: 'Applying tags failed' });
    expect(screen.getByText('Applying tags failed')).toBeInTheDocument();
  });
});
