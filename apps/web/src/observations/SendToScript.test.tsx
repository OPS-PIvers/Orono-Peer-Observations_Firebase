import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TranscriptSummary } from '@ops/shared';

const { summarize } = vi.hoisted(() => ({
  summarize: { fn: undefined as unknown as Mock<(data: unknown) => Promise<unknown>> },
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => {
    summarize.fn = vi.fn<(data: unknown) => Promise<unknown>>();
    return (data: unknown) => summarize.fn(data);
  },
}));
vi.mock('@/lib/firebase', () => ({ functions: {} }));
vi.mock('@/dev/viewAsGuard', () => ({ assertWritable: vi.fn() }));

import { SendToScript } from './SendToScript';

const SUMMARY: TranscriptSummary = {
  mode: 'domains',
  focus: null,
  summary: 'A lesson.',
  sections: [{ componentId: '2b', heading: 'Culture', noticed: 'n', evidence: [] }],
  reflectionQuestions: [],
  components: [],
};

const COMPONENTS = [
  { id: '2b', title: 'Fostering a Culture for Learning', bg: '#dcfce7', fg: '#14532d' },
  { id: '3e', title: 'Responding Flexibly', bg: '#ede9fe', fg: '#4c1d95' },
];

function setup(onInsertSummary: ((s: TranscriptSummary) => void) | null = vi.fn()) {
  const onInsertFull = vi.fn();
  render(
    <SendToScript
      observationId="obs-1"
      audioFileId="a1"
      onInsertFull={onInsertFull}
      onInsertSummary={onInsertSummary}
      assignedComponents={COMPONENTS}
      added={[]}
    />,
  );
  return { onInsertFull, onInsertSummary };
}

beforeEach(() => {
  summarize.fn.mockReset();
});

describe('SendToScript', () => {
  it('keeps the plain Insert into script button when summaries are off', async () => {
    const { onInsertFull } = setup(null);
    expect(screen.queryByRole('button', { name: /send to script/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Insert into script' }));
    expect(onInsertFull).toHaveBeenCalledOnce();
  });

  it('defaults to assigned-domain evidence and shows the assigned components', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /send to script/i }));
    expect(screen.getByRole('radio', { name: /assigned-domain evidence/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText('Fostering a Culture for Learning')).toBeInTheDocument();
  });

  it('sends the full transcript without calling the server', async () => {
    const { onInsertFull } = setup();
    await userEvent.click(screen.getByRole('button', { name: /send to script/i }));
    await userEvent.click(screen.getByRole('radio', { name: /full transcript/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Send full transcript' }));
    expect(onInsertFull).toHaveBeenCalledOnce();
    expect(summarize.fn).not.toHaveBeenCalled();
  });

  it('generates assigned-domain evidence and hands it to the editor', async () => {
    summarize.fn.mockResolvedValue({ data: SUMMARY });
    const { onInsertSummary } = setup();
    await userEvent.click(screen.getByRole('button', { name: /send to script/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Send evidence to script' }));
    await waitFor(() => expect(onInsertSummary).toHaveBeenCalledWith(SUMMARY));
    expect(summarize.fn).toHaveBeenCalledWith({
      observationId: 'obs-1',
      audioFileId: 'a1',
      mode: 'domains',
    });
  });

  it('needs a focus before a custom summary can be generated', async () => {
    summarize.fn.mockResolvedValue({ data: { ...SUMMARY, mode: 'custom' } });
    setup();
    await userEvent.click(screen.getByRole('button', { name: /send to script/i }));
    await userEvent.click(screen.getByRole('radio', { name: /custom/i }));
    const generate = screen.getByRole('button', { name: 'Generate and send' });
    expect(generate).toBeDisabled();
    await userEvent.type(screen.getByLabelText('What to look for'), 'Feedback to students');
    await userEvent.click(generate);
    await waitFor(() =>
      expect(summarize.fn).toHaveBeenCalledWith({
        observationId: 'obs-1',
        audioFileId: 'a1',
        mode: 'custom',
        focus: 'Feedback to students',
      }),
    );
  });

  it('shows the error and keeps the options open when generation fails', async () => {
    summarize.fn.mockRejectedValue(new Error('Daily limit reached (50/day).'));
    const { onInsertSummary } = setup();
    await userEvent.click(screen.getByRole('button', { name: /send to script/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Send evidence to script' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Daily limit reached');
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(onInsertSummary).not.toHaveBeenCalled();
  });
});
