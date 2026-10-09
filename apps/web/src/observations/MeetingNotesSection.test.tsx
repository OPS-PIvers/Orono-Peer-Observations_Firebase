import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TiptapDoc } from '@ops/shared';
import { MeetingNotesSection, type GoalsSlot } from './MeetingNotesSection';

vi.mock('@/components/ui/tiptap-editor', () => ({
  TiptapEditor: ({ placeholder, readOnly }: { placeholder?: string; readOnly?: boolean }) => (
    <div data-testid="editor" data-readonly={readOnly ? 'true' : 'false'}>
      {placeholder}
    </div>
  ),
}));

const TEXT: TiptapDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Goal one' }] }],
};

function goals(overrides: Partial<GoalsSlot> = {}): GoalsSlot {
  return {
    response: undefined,
    responseEditable: false,
    onResponseChange: () => undefined,
    saveState: 'idle',
    saveError: null,
    onRetrySave: () => undefined,
    isOnline: true,
    notes: undefined,
    onNotesChange: () => undefined,
    ...overrides,
  };
}

function renderSection(slot: GoalsSlot, readOnly: boolean) {
  render(
    <MeetingNotesSection
      preObsDate={undefined}
      preObsNotes={undefined}
      postObsDate={undefined}
      postObsNotes={undefined}
      readOnly={readOnly}
      onPreObsDateChange={() => undefined}
      onPreObsNotesChange={() => undefined}
      onPostObsDateChange={() => undefined}
      onPostObsNotesChange={() => undefined}
      goals={slot}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Goals & Next Steps/ }));
}

describe('MeetingNotesSection Goals & Next Steps', () => {
  it('gives the observed teacher an editable response box', () => {
    renderSection(goals({ responseEditable: true }), true);
    const editors = screen.getAllByTestId('editor');
    expect(editors).toHaveLength(1);
    expect(editors[0]).toHaveTextContent('Type your response here…');
    expect(editors[0]).toHaveAttribute('data-readonly', 'false');
    expect(screen.queryByText('Evaluator notes')).not.toBeInTheDocument();
  });

  it('shows the evaluator the teacher response read-only above editable notes', () => {
    renderSection(goals({ response: TEXT }), false);
    const editors = screen.getAllByTestId('editor');
    expect(editors).toHaveLength(2);
    expect(editors[0]).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByText('Evaluator notes')).toBeInTheDocument();
    expect(editors[1]).toHaveAttribute('data-readonly', 'false');
  });

  it('tells the evaluator when the teacher has not answered yet', () => {
    renderSection(goals(), false);
    expect(screen.getByText('Not yet answered')).toBeInTheDocument();
  });
});
