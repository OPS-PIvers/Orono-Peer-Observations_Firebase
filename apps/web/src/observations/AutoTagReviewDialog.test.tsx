import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  AutoTagReviewDialog,
  type AutoTagRunInfo,
  type AutoTagSuggestion,
} from './AutoTagReviewDialog';

const SUGGESTIONS: [AutoTagSuggestion, AutoTagSuggestion] = [
  {
    paragraphIndex: 0,
    text: 'turned and talked',
    componentId: '1a',
    componentTitle: 'Knowledge of Content',
    paragraphText: 'Students turned and talked about the prompt.',
    status: 'pending',
  },
  {
    paragraphIndex: 1,
    text: 'circulated',
    componentId: '2b',
    componentTitle: 'Culture for Learning',
    paragraphText: 'The teacher circulated during work time.',
    status: 'pending',
  },
];

const FIRST_RUN: AutoTagRunInfo = {
  reused: false,
  createdAt: '2026-10-14T19:00:00.000Z',
  createdBy: 'observer@orono.k12.mn.us',
  runCount: 1,
  reason: null,
};

const COLORS = new Map([
  ['1a', { bg: '#dbeafe', fg: '#1e3a8a' }],
  ['2b', { bg: '#dcfce7', fg: '#14532d' }],
]);

function renderDialog(over: Partial<Parameters<typeof AutoTagReviewDialog>[0]> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const onRerun = vi.fn();
  render(
    <AutoTagReviewDialog
      open
      suggestions={SUGGESTIONS}
      colorById={COLORS}
      skippedCount={0}
      run={FIRST_RUN}
      applying={false}
      rerunning={false}
      error={null}
      onCancel={onCancel}
      onApply={onApply}
      onRerun={onRerun}
      {...over}
    />,
  );
  return { onApply, onCancel, onRerun };
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

  it('reopens a saved run with applied ones locked and left-out ones unchecked', async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog({
      suggestions: [
        { ...SUGGESTIONS[0], status: 'applied' },
        { ...SUGGESTIONS[1], status: 'dismissed' },
      ],
      run: { ...FIRST_RUN, reused: true },
    });

    expect(screen.getByText('Earlier auto-tag suggestions')).toBeInTheDocument();
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /tag "turned and talked" as 1a/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /apply 0 tags/i })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /tag "circulated" as 2b/i }));
    await user.click(screen.getByRole('button', { name: /apply 1 tag$/i }));
    expect(onApply.mock.calls[0]?.[0]).toEqual([{ ...SUGGESTIONS[1], status: 'dismissed' }]);
  });

  it('does not offer suggestions the script no longer contains', () => {
    renderDialog({ suggestions: [{ ...SUGGESTIONS[0], status: 'stale' }] });
    expect(screen.getByText('Script changed')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /tag "turned and talked" as 1a/i })).toBeDisabled();
  });

  it('needs a reason before it will run auto-tag again', async () => {
    const user = userEvent.setup();
    const { onRerun } = renderDialog();

    await user.click(screen.getByRole('button', { name: /run again/i }));
    const submit = screen.getByRole('button', { name: /run auto-tag again/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/what should the ai know/i), 'again');
    expect(submit).toBeDisabled();

    await user.type(
      screen.getByLabelText(/what should the ai know/i),
      ' — I added the second half of the lesson',
    );
    await user.click(submit);
    expect(onRerun).toHaveBeenCalledWith('again — I added the second half of the lesson');
  });

  it('shows the reason the last run was made with', () => {
    renderDialog({ run: { ...FIRST_RUN, runCount: 2, reason: 'Added exit ticket notes' } });
    expect(screen.getByText(/Run 2/)).toBeInTheDocument();
    expect(screen.getByText(/Added exit ticket notes/)).toBeInTheDocument();
  });

  it('lets an empty run be re-run', () => {
    renderDialog({ suggestions: [] });
    expect(screen.getByText(/found no taggable evidence/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run again/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
  });
});
