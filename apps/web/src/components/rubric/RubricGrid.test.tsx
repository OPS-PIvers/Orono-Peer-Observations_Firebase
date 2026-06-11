import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ObservationComponentEntry, Rubric, TiptapDoc } from '@ops/shared';
import { RubricGrid, type RubricGridMode } from './RubricGrid';

// Mock firebase so RubricRow's httpsCallable import doesn't trigger a real
// Firebase initialization (which requires valid env vars) during tests.
vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

function makeRubric(): Rubric {
  return {
    rubricId: 'test-rubric',
    displayName: 'Test',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    domains: [
      {
        id: '1',
        name: 'Planning and Preparation',
        components: [
          {
            id: '1a',
            title: 'Demonstrating Knowledge of Content',
            proficiencyLevels: {
              developing: 'Developing 1a description',
              basic: 'Basic 1a description',
              proficient: 'Proficient 1a description',
              distinguished: 'Distinguished 1a description',
            },
            lookFors: [
              { id: 'lf1', text: 'Look-for one' },
              { id: 'lf2', text: 'Look-for two' },
            ],
          },
          {
            id: '1b',
            title: 'Demonstrating Knowledge of Students',
            proficiencyLevels: {
              developing: 'Developing 1b',
              basic: 'Basic 1b',
              proficient: 'Proficient 1b',
              distinguished: 'Distinguished 1b',
            },
            lookFors: [],
          },
        ],
      },
      {
        id: '2',
        name: 'Classroom Environment',
        components: [
          {
            id: '2a',
            title: 'Creating an Environment of Respect',
            proficiencyLevels: {
              developing: 'Developing 2a',
              basic: 'Basic 2a',
              proficient: 'Proficient 2a',
              distinguished: 'Distinguished 2a',
            },
            lookFors: [],
          },
        ],
      },
    ],
  };
}

describe('<RubricGrid> view mode', () => {
  it('renders all four descriptors per row across all domains', () => {
    const rubric = makeRubric();
    render(
      <RubricGrid
        rubric={rubric}
        mode={{
          kind: 'view',
          assignedComponentIds: new Set(['1a']),
          showAssignedOnly: false,
        }}
        storageScope="test-view"
      />,
    );
    expect(screen.getByText('Domain 1: Planning and Preparation')).toBeInTheDocument();
    expect(screen.getByText('Domain 2: Classroom Environment')).toBeInTheDocument();
    expect(screen.getByText('Demonstrating Knowledge of Content')).toBeInTheDocument();
    expect(screen.getByText('Proficient 1a description')).toBeInTheDocument();
    expect(screen.getByText('Distinguished 2a')).toBeInTheDocument();
  });

  it('shows the "Assigned" label only for assigned components', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={{
          kind: 'view',
          assignedComponentIds: new Set(['1a']),
          showAssignedOnly: false,
        }}
        storageScope="test-view"
      />,
    );
    // 1a is the only assigned component out of three (1a, 1b, 2a).
    expect(screen.getAllByText('Assigned')).toHaveLength(1);
  });

  it('hides unassigned components when showAssignedOnly is true', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={{
          kind: 'view',
          assignedComponentIds: new Set(['1a']),
          showAssignedOnly: true,
        }}
        storageScope="test-view"
      />,
    );
    expect(screen.getByText('Demonstrating Knowledge of Content')).toBeInTheDocument();
    expect(screen.queryByText('Demonstrating Knowledge of Students')).not.toBeInTheDocument();
    expect(screen.queryByText('Domain 2: Classroom Environment')).not.toBeInTheDocument();
  });

  it('does not render clickable proficiency cells in view mode', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={{
          kind: 'view',
          assignedComponentIds: new Set(['1a']),
          showAssignedOnly: false,
        }}
        storageScope="test-view"
      />,
    );
    expect(
      screen.queryByRole('button', { name: /developing — Developing 1a description/i }),
    ).not.toBeInTheDocument();
  });

  it('does not render the notes or evidence chips in view mode', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={{
          kind: 'view',
          assignedComponentIds: new Set(['1a']),
          showAssignedOnly: false,
        }}
        storageScope="test-view"
      />,
    );
    expect(screen.queryByRole('button', { name: /Notes/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Evidence/ })).not.toBeInTheDocument();
  });
});

describe('<RubricGrid> edit mode', () => {
  function editMode(
    overrides: Partial<Extract<RubricGridMode, { kind: 'edit' }>> = {},
  ): RubricGridMode {
    return {
      kind: 'edit',
      assignedComponentIds: new Set(['1a', '1b', '2a']),
      entries: {},
      notes: {},
      evidenceLinks: {},
      observationId: 'test-obs',
      readOnly: false,
      onProficiency: vi.fn(),
      onToggleLookFor: vi.fn(),
      onNotesChange: vi.fn(),
      ...overrides,
    };
  }

  it('cell click in edit mode invokes onProficiency', async () => {
    const onProficiency = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ onProficiency })}
        storageScope="test-edit"
      />,
    );
    const cell = screen.getByRole('gridcell', {
      name: /proficient — Proficient 1a description/i,
    });
    await userEvent.click(cell);
    expect(onProficiency).toHaveBeenCalledWith('1a', 'proficient');
  });

  it('clicking the selected cell again clears the selection', async () => {
    const onProficiency = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({
          entries: {
            '1a': {
              proficiency: 'proficient',
              selectedLookForIds: [],
              scratchNotes: '',
            } satisfies ObservationComponentEntry,
          },
          onProficiency,
        })}
        storageScope="test-edit"
      />,
    );
    const cell = screen.getByRole('gridcell', {
      name: /proficient — Proficient 1a description/i,
    });
    expect(cell).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(cell);
    expect(onProficiency).toHaveBeenCalledWith('1a', null);
  });

  it('readOnly disables cell clicks and look-for checkboxes', async () => {
    const onProficiency = vi.fn();
    const onToggleLookFor = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ readOnly: true, onProficiency, onToggleLookFor })}
        storageScope="test-edit-readonly"
      />,
    );
    const cell = screen.getByRole('gridcell', {
      name: /developing — Developing 1a description/i,
    });
    await userEvent.click(cell);
    expect(onProficiency).not.toHaveBeenCalled();

    // Open the look-fors panel; checkboxes should be disabled.
    await userEvent.click(screen.getByRole('button', { name: /Look-fors/ }));
    const checkbox = screen.getByRole('checkbox', { name: 'Look-for one' });
    expect(checkbox).toBeDisabled();
  });

  it('look-fors chip toggles the panel and checkbox click syncs state', async () => {
    const onToggleLookFor = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ onToggleLookFor })}
        storageScope="test-edit-lf"
      />,
    );
    // Panel starts closed.
    expect(screen.queryByRole('checkbox', { name: 'Look-for one' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Look-fors/ }));
    const checkbox = screen.getByRole('checkbox', { name: 'Look-for one' });
    await userEvent.click(checkbox);
    expect(onToggleLookFor).toHaveBeenCalledWith('1a', 'lf1');
  });

  it('lazy-mounts Tiptap only when the notes panel is opened', async () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-notes" />);
    // Pre-open: no contenteditable in the document.
    expect(document.querySelector('[contenteditable]')).toBeNull();

    const [firstNotesChip] = screen.getAllByRole('button', { name: /^Notes$/ });
    if (!firstNotesChip) throw new Error('expected a Notes chip button');
    await userEvent.click(firstNotesChip);
    expect(document.querySelector('[contenteditable]')).not.toBeNull();
  });

  it('does NOT auto-open the notes panel even when the component has notes', () => {
    const notesDoc: TiptapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Existing note' }],
        },
      ],
    };
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ notes: { '1a': notesDoc } })}
        storageScope="test-edit-auto-notes"
      />,
    );
    // Panel stays closed; the user clicks the chip to view existing notes.
    expect(document.querySelector('[contenteditable]')).toBeNull();
  });

  it('selected proficiency cell renders with selected styling and aria-selected=true', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({
          entries: {
            '2a': {
              proficiency: 'distinguished',
              selectedLookForIds: [],
              scratchNotes: '',
            },
          },
        })}
        storageScope="test-edit-selected"
      />,
    );
    const row = screen
      .getByText('Creating an Environment of Respect')
      .closest('[data-component-row]');
    if (!(row instanceof HTMLElement)) throw new Error('expected component row to exist');
    const selected = within(row).getByRole('gridcell', {
      name: /distinguished — Distinguished 2a/i,
    });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected.className).toMatch(/bg-ops-blue/);
  });
});

describe('<RubricGrid> edit mode — unassigned components (Full Rubric view)', () => {
  function editMode(
    overrides: Partial<Extract<RubricGridMode, { kind: 'edit' }>> = {},
  ): RubricGridMode {
    return {
      kind: 'edit',
      assignedComponentIds: new Set(['1a']),
      entries: {},
      notes: {},
      evidenceLinks: {},
      observationId: 'test-obs',
      readOnly: false,
      onProficiency: vi.fn(),
      onToggleLookFor: vi.fn(),
      onNotesChange: vi.fn(),
      ...overrides,
    };
  }

  it('renders unassigned descriptor cells non-interactive and ignores clicks', async () => {
    const onProficiency = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ onProficiency })}
        storageScope="test-edit-unassigned"
      />,
    );
    // The assigned component (1a) stays clickable…
    const assignedCell = screen.getByRole('gridcell', {
      name: /proficient — Proficient 1a description/i,
    });
    expect(assignedCell.tagName).toBe('BUTTON');
    // …while the unassigned ones (1b, 2a) are reference-only.
    const unassignedCell = screen.getByRole('gridcell', {
      name: /proficient — Proficient 1b/i,
    });
    expect(unassignedCell.tagName).not.toBe('BUTTON');
    await userEvent.click(unassignedCell);
    expect(onProficiency).not.toHaveBeenCalled();
  });

  it('shows the "Not assigned for this cycle" note on unassigned rows only', () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-note" />);
    // 1b and 2a are unassigned; 1a is assigned.
    expect(screen.getAllByText('Not assigned for this cycle')).toHaveLength(2);
    const assignedRow = screen
      .getByText('Demonstrating Knowledge of Content')
      .closest('[data-component-row]');
    if (!(assignedRow instanceof HTMLElement)) throw new Error('expected component row to exist');
    expect(within(assignedRow).queryByText('Not assigned for this cycle')).not.toBeInTheDocument();
  });

  it('hides the Notes and Evidence chips on unassigned rows', () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-chips" />);
    // Only the assigned 1a row keeps its Notes/Evidence chips.
    expect(screen.getAllByRole('button', { name: /^Notes$/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Evidence$/ })).toHaveLength(1);
  });

  it('disables look-for checkboxes on unassigned rows', async () => {
    const onToggleLookFor = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        // 1a (the only component with look-fors) is NOT assigned here.
        mode={editMode({ assignedComponentIds: new Set(['2a']), onToggleLookFor })}
        storageScope="test-edit-lf-unassigned"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Look-fors/ }));
    const checkbox = screen.getByRole('checkbox', { name: 'Look-for one' });
    expect(checkbox).toBeDisabled();
    await userEvent.click(checkbox);
    expect(onToggleLookFor).not.toHaveBeenCalled();
  });

  it('still displays a previously persisted score on an unassigned row (read-only)', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({
          entries: {
            '1b': {
              proficiency: 'basic',
              selectedLookForIds: [],
              scratchNotes: '',
            } satisfies ObservationComponentEntry,
          },
        })}
        storageScope="test-edit-legacy-score"
      />,
    );
    const cell = screen.getByRole('gridcell', { name: /basic — Basic 1b/i });
    expect(cell.tagName).not.toBe('BUTTON');
    expect(cell).toHaveAttribute('aria-selected', 'true');
  });
});
