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

  it('does not render the notes strip toggle in view mode', () => {
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
    expect(screen.queryByRole('button', { name: /add notes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /view notes/i })).not.toBeInTheDocument();
  });
});

describe('<RubricGrid> edit mode', () => {
  function editMode(
    overrides: Partial<Extract<RubricGridMode, { kind: 'edit' }>> = {},
  ): RubricGridMode {
    return {
      kind: 'edit',
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

    // Expand the look-fors strip; checkboxes should be disabled.
    await userEvent.click(screen.getByRole('button', { name: /look-fors \(2\)/i }));
    const checkbox = screen.getByRole('checkbox', { name: 'Look-for one' });
    expect(checkbox).toBeDisabled();
  });

  it('look-fors strip toggles open and checkbox click syncs state', async () => {
    const onToggleLookFor = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ onToggleLookFor })}
        storageScope="test-edit-lf"
      />,
    );
    // Strip starts collapsed.
    expect(screen.queryByRole('checkbox', { name: 'Look-for one' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /look-fors \(2\)/i }));
    const checkbox = screen.getByRole('checkbox', { name: 'Look-for one' });
    await userEvent.click(checkbox);
    expect(onToggleLookFor).toHaveBeenCalledWith('1a', 'lf1');
  });

  it('lazy-mounts Tiptap only when notes strip is expanded', async () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-notes" />);
    // Pre-expand: no contenteditable in the document.
    expect(document.querySelector('[contenteditable]')).toBeNull();

    const [firstAddNotes] = screen.getAllByRole('button', { name: /add notes/i });
    if (!firstAddNotes) throw new Error('expected an Add notes button');
    await userEvent.click(firstAddNotes);
    expect(document.querySelector('[contenteditable]')).not.toBeNull();
  });

  it('auto-expands the notes strip when the component already has note content', () => {
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
    // Auto-expanded → Tiptap mounted.
    expect(document.querySelector('[contenteditable]')).not.toBeNull();
  });

  it('does NOT auto-expand the notes strip for an empty paragraph doc', () => {
    const blankDoc: TiptapDoc = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ notes: { '1a': blankDoc } })}
        storageScope="test-edit-blank-notes"
      />,
    );
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
