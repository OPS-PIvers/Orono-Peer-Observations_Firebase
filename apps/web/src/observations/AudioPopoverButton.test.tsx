import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Stub the recorder so the test doesn't pull in Firebase / MediaRecorder; we
// only care about the popover's open/close focus management here.
vi.mock('./AudioRecorder', () => ({
  AudioRecorder: () => (
    <button type="button" data-testid="recorder-stub">
      Record
    </button>
  ),
}));

import { AudioPopoverButton } from './AudioPopoverButton';

const baseProps = {
  observationId: 'obs-1',
  audioFileIds: [] as string[],
  transcripts: {} as Record<string, string>,
  readOnly: false,
};

describe('AudioPopoverButton focus management', () => {
  it('moves focus into the popover on open and restores it to the trigger on Escape', async () => {
    const user = userEvent.setup();
    render(<AudioPopoverButton {...baseProps} />);

    const trigger = screen.getByRole('button', { name: /record audio/i });
    await user.click(trigger);

    const stub = screen.getByTestId('recorder-stub');
    expect(stub).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});
