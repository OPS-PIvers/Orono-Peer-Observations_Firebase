import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('labels each static descriptor cell with its proficiency level', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={{
          kind: 'view',
          assignedComponentIds: new Set(['1a']),
          showAssignedOnly: false,
        }}
        storageScope="test-view-labels"
      />,
    );
    // Role-less cells cannot take an aria-label, so the level is carried
    // by visually-hidden text inside the cell instead.
    const cell = document.querySelector(
      '[data-component-row="1a"] [data-proficiency="proficient"]',
    );
    if (!(cell instanceof HTMLElement)) throw new Error('expected a proficient descriptor cell');
    expect(cell).not.toHaveAttribute('role');
    expect(cell.querySelector('.sr-only')?.textContent).toBe('Proficient: ');
    expect(cell.textContent).toContain('Proficient 1a description');
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
    const cell = screen.getByRole('button', {
      name: /Proficient — Proficient 1a description/i,
    });
    await userEvent.click(cell);
    expect(onProficiency).toHaveBeenCalledWith('1a', 'proficient');
  });

  it('clicking the pressed toggle again clears the selection', async () => {
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
    const cell = screen.getByRole('button', {
      name: /Proficient — Proficient 1a description/i,
    });
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(cell);
    expect(onProficiency).toHaveBeenCalledWith('1a', null);
  });

  it('readOnly exposes no interactive proficiency control and disables look-fors', async () => {
    const onProficiency = vi.fn();
    const onToggleLookFor = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({
          readOnly: true,
          onProficiency,
          onToggleLookFor,
          entries: {
            '1a': { proficiency: 'proficient', selectedLookForIds: [], scratchNotes: '' },
          },
        })}
        storageScope="test-edit-readonly"
      />,
    );
    // A rating that cannot be changed must not advertise interactive
    // semantics: no toolbar, no toggle buttons, no radios.
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Developing — Developing 1a description/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    // The saved rating is still announced, via the group's accessible name.
    expect(
      screen.getByRole('group', {
        name: 'Demonstrating Knowledge of Content proficiency rating: Proficient',
      }),
    ).toBeInTheDocument();
    // ...and an unrated component reports that explicitly.
    expect(
      screen.getByRole('group', {
        name: 'Demonstrating Knowledge of Students proficiency rating: Not rated',
      }),
    ).toBeInTheDocument();
    expect(onProficiency).not.toHaveBeenCalled();

    // The saved cell also marks itself for a reader walking the cells.
    const saved = document.querySelector(
      '[data-component-row="1a"] [data-proficiency="proficient"]',
    );
    expect(saved?.querySelector('.sr-only')?.textContent).toBe('Proficient (saved rating): ');

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

  it('selected proficiency cell renders with selected styling and aria-pressed=true', () => {
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
    const selected = within(row).getByRole('button', {
      name: /Distinguished — Distinguished 2a/i,
    });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected.className).toMatch(/bg-ops-blue/);
  });

  // ─── APG Toolbar + toggle-button pattern ──────────────────────────────────

  /** The four proficiency toggle buttons of component 1a, in level order. */
  function proficiencyToggles(): HTMLElement[] {
    const toolbar = screen.getByRole('toolbar', {
      name: 'Demonstrating Knowledge of Content proficiency rating',
    });
    return within(toolbar).getAllByRole('button');
  }

  it('renders the four descriptors as a horizontal toolbar of toggle buttons', () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-toolbar" />);
    const toolbar = screen.getByRole('toolbar', {
      name: 'Demonstrating Knowledge of Content proficiency rating',
    });
    expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');
    const toggles = within(toolbar).getAllByRole('button');
    expect(toggles).toHaveLength(4);
    for (const toggle of toggles) {
      expect(toggle).toHaveAttribute('aria-pressed');
    }
  });

  it('never uses radio semantics, which would forbid click-to-clear', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({
          entries: {
            '1a': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' },
          },
        })}
        storageScope="test-edit-no-radio"
      />,
    );
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('radiogroup')).toHaveLength(0);
  });

  it('presses exactly one toggle at a time', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({
          entries: {
            '1a': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' },
          },
        })}
        storageScope="test-edit-single-pressed"
      />,
    );
    const pressed = proficiencyToggles().filter((t) => t.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAttribute('data-proficiency', 'basic');
  });

  it('roving tabindex starts on the first toggle when nothing is pressed', () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-roving" />);
    const toggles = proficiencyToggles();
    expect(toggles[0]?.tabIndex).toBe(0);
    expect(toggles[1]?.tabIndex).toBe(-1);
    expect(toggles[2]?.tabIndex).toBe(-1);
    expect(toggles[3]?.tabIndex).toBe(-1);
  });

  it('roving tabindex starts on the pressed toggle', () => {
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({
          entries: {
            '1a': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' },
          },
        })}
        storageScope="test-edit-roving-selected"
      />,
    );
    const toggles = proficiencyToggles();
    // developing=0, basic=1, proficient=2, distinguished=3
    expect(toggles[1]?.tabIndex).toBe(0);
    expect(toggles[0]?.tabIndex).toBe(-1);
  });

  it('Left/Right move focus without activating; Home/End jump to the ends', async () => {
    const onProficiency = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ onProficiency })}
        storageScope="test-edit-arrows"
      />,
    );
    const toggles = proficiencyToggles();
    toggles[0]?.focus();
    expect(document.activeElement).toBe(toggles[0]);

    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(toggles[1]);
    expect(toggles[1]?.tabIndex).toBe(0);
    expect(toggles[0]?.tabIndex).toBe(-1);

    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(toggles[2]);

    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(toggles[1]);

    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(toggles[3]);

    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(toggles[0]);

    // Moving focus never selects — APG toolbars activate on Enter/Space only.
    expect(onProficiency).not.toHaveBeenCalled();
  });

  it('leaves Up/Down Arrow to the page, per the horizontal-toolbar pattern', async () => {
    render(
      <RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-vertical" />,
    );
    const toggles = proficiencyToggles();
    toggles[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(toggles[0]);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(toggles[0]);
  });

  it('wraps from the first toggle to the last on ArrowLeft', async () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-wrap" />);
    const toggles = proficiencyToggles();
    toggles[0]?.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(toggles[3]);
  });

  it('Enter activates the toggle that currently has focus after arrow navigation', async () => {
    const onProficiency = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({ onProficiency })}
        storageScope="test-edit-enter-select"
      />,
    );
    const toggles = proficiencyToggles();
    toggles[0]?.focus();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(onProficiency).toHaveBeenCalledWith('1a', 'basic');
  });

  it('Space on the pressed toggle clears the rating', async () => {
    const onProficiency = vi.fn();
    render(
      <RubricGrid
        rubric={makeRubric()}
        mode={editMode({
          entries: {
            '1a': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' },
          },
          onProficiency,
        })}
        storageScope="test-edit-space-clear"
      />,
    );
    const toggles = proficiencyToggles();
    toggles[1]?.focus();
    await userEvent.keyboard('[Space]');
    expect(onProficiency).toHaveBeenCalledWith('1a', null);
  });

  it('the look-fors checklist is a labeled group of real checkboxes', async () => {
    render(
      <RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-lf-group" />,
    );
    const [firstLookForsChip] = screen.getAllByRole('button', { name: /Look-fors/ });
    if (!firstLookForsChip) throw new Error('expected a Look-fors chip button');
    await userEvent.click(firstLookForsChip);
    const group = screen.getByRole('group', {
      name: /Look-fors for Demonstrating Knowledge of Content/i,
    });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2);
  });

  // ─── Valid role nesting ───────────────────────────────────────────────────

  const roleContextCases: [label: string, makeMode: () => RubricGridMode][] = [
    ['edit', () => editMode()],
    [
      'view',
      () => ({
        kind: 'view',
        assignedComponentIds: new Set(['1a']),
        showAssignedOnly: false,
      }),
    ],
  ];

  it.each(roleContextCases)('asserts no grid/table roles (%s mode)', (label, makeMode) => {
    render(
      <RubricGrid rubric={makeRubric()} mode={makeMode()} storageScope={`test-roles-${label}`} />,
    );
    // role="row"/"rowgroup"/"rowheader"/"columnheader"/"gridcell" all have a
    // required context role (grid/table/treegrid). The rubric matrix has no
    // such ancestor, so it must assert none of them.
    for (const role of ['row', 'rowgroup', 'rowheader', 'columnheader', 'gridcell'] as const) {
      expect(screen.queryAllByRole(role, { hidden: true })).toHaveLength(0);
    }
    expect(document.querySelectorAll('[role="row"],[role="rowgroup"]')).toHaveLength(0);
    expect(
      document.querySelectorAll('[role="rowheader"],[role="columnheader"],[role="gridcell"]'),
    ).toHaveLength(0);
  });

  // ─── Touch targets (WCAG 2.5.5, 44x44 CSS px) ─────────────────────────────

  it('gives every proficiency toggle the 44px minimum touch target', () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-target" />);
    for (const toggle of proficiencyToggles()) {
      expect(toggle.className).toMatch(/(^|\s)min-h-11(\s|$)/);
    }
  });

  it('gives the look-for tap target the 44px minimum', async () => {
    render(<RubricGrid rubric={makeRubric()} mode={editMode()} storageScope="test-edit-lf-size" />);
    const [firstLookForsChip] = screen.getAllByRole('button', { name: /Look-fors/ });
    if (!firstLookForsChip) throw new Error('expected a Look-fors chip button');
    await userEvent.click(firstLookForsChip);
    const label = screen.getByRole('checkbox', { name: 'Look-for one' }).closest('label');
    if (!(label instanceof HTMLElement)) throw new Error('expected a wrapping label');
    expect(label.className).toMatch(/(^|\s)min-h-11(\s|$)/);
  });
});

// ─── Mobile accordion (iPad mini portrait is 744px → below the 768px
//     useIsDesktop breakpoint, so this tree is a real iPad target) ───────────

describe('<RubricGrid> mobile layout touch targets', () => {
  const desktopMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = desktopMatchMedia;
  });

  function mobileEditMode(): RubricGridMode {
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
    };
  }

  it('meets 44px on the component tab strip, section rows, level rows and Select', async () => {
    render(
      <RubricGrid rubric={makeRubric()} mode={mobileEditMode()} storageScope="test-mobile-size" />,
    );

    // The desktop matrix must not be what rendered.
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /Domain 1: Planning and Preparation/ }),
    );

    // Component tab strip.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) {
      expect(tab.className).toMatch(/(^|\s)min-h-11(\s|$)/);
    }

    // Collapsible section rows (Ratings / Look-fors / Notes / Evidence).
    const ratings = screen.getByRole('button', { name: /Ratings/ });
    expect(ratings.className).toMatch(/(^|\s)min-h-11(\s|$)/);

    await userEvent.click(ratings);

    // Proficiency level rows.
    const levelRow = screen.getByRole('button', { name: 'proficient descriptor' });
    expect(levelRow.className).toMatch(/(^|\s)min-h-11(\s|$)/);

    // ...and the Select control revealed inside an expanded level row.
    await userEvent.click(levelRow);
    const select = screen.getByRole('button', { name: 'Select Proficient' });
    expect(select.className).toMatch(/(^|\s)min-h-11(\s|$)/);
  });
});
