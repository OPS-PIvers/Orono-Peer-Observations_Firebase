import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rubric, RubricDomain } from '@ops/shared';

interface SavePayload {
  rubricId: string;
  displayName: string;
  domains: RubricDomain[];
  createdAt: unknown;
  updatedAt: unknown;
}

// Hoisted so vi.mock factories (lifted to file top by Vitest) can reference
// these without hitting the temporal dead zone.
const { setDocMock, navigateMock } = vi.hoisted(() => ({
  setDocMock: vi.fn<(ref: { path: string }, payload: SavePayload) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  navigateMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  setDoc: setDocMock,
  doc: (_db: unknown, _collection: string, id: string) => ({ path: `rubrics/${id}` }),
  serverTimestamp: () => 'server-timestamp',
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('react-router-dom', async (importOriginal: () => Promise<Record<string, unknown>>) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock };
});

import { CreateRubricDialog } from './CreateRubricDialog';

function makeRubric(rubricId: string, displayName: string): Rubric & { id: string } {
  return {
    id: rubricId,
    rubricId,
    displayName,
    domains: [
      {
        id: '1',
        name: 'Domain 1',
        components: [
          {
            id: '1a',
            title: 'Component 1a',
            proficiencyLevels: { developing: 'd', basic: 'b', proficient: 'p', distinguished: 'x' },
            lookFors: [{ id: 'lf-1', text: 'look for text' }],
          },
        ],
      },
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

beforeEach(() => {
  setDocMock.mockClear();
  navigateMock.mockClear();
});

function renderDialog(props: Partial<Parameters<typeof CreateRubricDialog>[0]> = {}) {
  const defaults = {
    open: true,
    onOpenChange: vi.fn(),
    existingRubrics: [] as (Rubric & { id: string })[],
  };
  return render(
    <MemoryRouter>
      <CreateRubricDialog {...defaults} {...props} />
    </MemoryRouter>,
  );
}

/** Extract the setDoc call payload, throwing if setDoc was never called. */
function getLastSaveCall(): { ref: { path: string }; payload: SavePayload } {
  const call = setDocMock.mock.calls.at(0);
  if (!call) throw new Error('setDoc was never called');
  const [ref, payload] = call;
  return { ref, payload };
}

describe('CreateRubricDialog slug derivation', () => {
  it('auto-derives rubricId from displayName', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Display name'), 'Library Media Specialist');

    expect(screen.getByLabelText('Rubric ID')).toHaveValue('library-media-specialist');
  });

  it('stops syncing rubricId once manually edited', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Display name'), 'Art');
    await user.clear(screen.getByLabelText('Rubric ID'));
    await user.type(screen.getByLabelText('Rubric ID'), 'custom-slug');
    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Art Teacher');

    // Manual edit should be preserved, not overwritten by the new displayName.
    expect(screen.getByLabelText('Rubric ID')).toHaveValue('custom-slug');
  });
});

describe('CreateRubricDialog validation', () => {
  it('rejects empty displayName', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create rubric' }));

    expect(await screen.findByText('Display name is required.')).toBeInTheDocument();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects invalid rubricId (not kebab-case)', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Display name'), 'Art');
    await user.clear(screen.getByLabelText('Rubric ID'));
    await user.type(screen.getByLabelText('Rubric ID'), 'Art Teacher');

    await user.click(screen.getByRole('button', { name: 'Create rubric' }));

    expect(await screen.findByText(/Rubric ID must be lower-kebab-case/)).toBeInTheDocument();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('rejects a duplicate rubricId that already exists', async () => {
    const user = userEvent.setup();
    renderDialog({ existingRubrics: [makeRubric('teacher', 'Teacher')] });

    await user.type(screen.getByLabelText('Display name'), 'Teacher Copy');
    await user.clear(screen.getByLabelText('Rubric ID'));
    await user.type(screen.getByLabelText('Rubric ID'), 'teacher');

    await user.click(screen.getByRole('button', { name: 'Create rubric' }));

    expect(
      await screen.findByText(/A rubric with ID "teacher" already exists/),
    ).toBeInTheDocument();
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('CreateRubricDialog blank scaffold create', () => {
  it('saves a 4-domain scaffold and navigates to the editor', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await user.type(screen.getByLabelText('Display name'), 'Library Media Specialist');
    await user.click(screen.getByRole('button', { name: 'Create rubric' }));

    await waitFor(() => {
      expect(setDocMock).toHaveBeenCalledTimes(1);
    });

    const { ref, payload } = getLastSaveCall();
    expect(ref.path).toBe('rubrics/library-media-specialist');
    expect(payload.rubricId).toBe('library-media-specialist');
    expect(payload.displayName).toBe('Library Media Specialist');
    expect(payload.createdAt).toBe('server-timestamp');
    expect(payload.updatedAt).toBe('server-timestamp');

    // Scaffold has exactly 4 domains.
    expect(payload.domains).toHaveLength(4);
    expect(payload.domains.map((d) => d.id)).toEqual(['1', '2', '3', '4']);

    // Dialog closed and editor navigated to.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateMock).toHaveBeenCalledWith('/admin/rubrics/library-media-specialist');
  });
});

describe('CreateRubricDialog copy-from flow', () => {
  it('deep-copies the selected rubric domains and saves', async () => {
    const user = userEvent.setup();
    const source = makeRubric('teacher', 'Teacher');
    const onOpenChange = vi.fn();
    renderDialog({ existingRubrics: [source], onOpenChange });

    await user.type(screen.getByLabelText('Display name'), 'New Teacher');

    await user.selectOptions(
      screen.getByLabelText('Copy from existing rubric (optional)'),
      'teacher',
    );

    await user.click(screen.getByRole('button', { name: 'Create rubric' }));

    await waitFor(() => {
      expect(setDocMock).toHaveBeenCalledTimes(1);
    });

    const { payload } = getLastSaveCall();
    expect(payload.domains).toHaveLength(1);
    expect(payload.domains[0]?.components[0]?.id).toBe('1a');
    // Deep copy — not the same object reference.
    expect(payload.domains[0]).not.toBe(source.domains[0]);
    expect(payload.domains[0]?.components[0]?.lookFors[0]).not.toBe(
      source.domains[0]?.components[0]?.lookFors[0],
    );
  });

  it('strips color: undefined from copied components to avoid Firestore rejection', async () => {
    const user = userEvent.setup();
    const source = makeRubric('teacher', 'Teacher');
    // Inject a stale color: undefined on the component (pre-fix artifact).
    const domain = source.domains[0];
    const comp = domain?.components[0];
    if (domain && comp) {
      domain.components[0] = { ...comp, color: undefined };
    }
    const onOpenChange = vi.fn();
    renderDialog({ existingRubrics: [source], onOpenChange });

    await user.type(screen.getByLabelText('Display name'), 'Copy');
    await user.selectOptions(
      screen.getByLabelText('Copy from existing rubric (optional)'),
      'teacher',
    );
    await user.click(screen.getByRole('button', { name: 'Create rubric' }));

    await waitFor(() => {
      expect(setDocMock).toHaveBeenCalledTimes(1);
    });

    const { payload } = getLastSaveCall();
    const savedComp = payload.domains[0]?.components[0];
    expect(savedComp).toBeDefined();
    expect('color' in (savedComp ?? {})).toBe(false);
  });
});

describe('CreateRubricDialog prefillRubricId', () => {
  it('pre-populates rubricId with the provided prefillRubricId', () => {
    renderDialog({ prefillRubricId: 'art-teacher' });

    expect(screen.getByLabelText('Rubric ID')).toHaveValue('art-teacher');
  });
});

describe('CreateRubricDialog cancel', () => {
  it('calls onOpenChange(false) without saving when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(setDocMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
