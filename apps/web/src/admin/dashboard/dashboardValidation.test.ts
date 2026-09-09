import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEPS,
  dashboardStep,
  type DashboardQuickMaterial,
  type DashboardStep,
} from '@ops/shared';
import {
  describeValidationFailure,
  findFieldError,
  validateDashboardDraft,
  validateLayout,
  validateQuickMaterials,
  validateSteps,
} from './dashboardValidation';
import type { DashboardDraft } from './useDashboardDraft';

/**
 * The pre-save gate. The key case is the first one: the exact object that
 * QuickMaterialsEditor.add() creates must be rejected, because that is the
 * blank card that used to reach Firestore.
 */

const SECTIONS: DashboardDraft['sections'] = {
  hero: true,
  roleChip: true,
  progressSummary: true,
  statBar: true,
  timeline: true,
  filterBar: true,
  quickMaterials: true,
  peerEvaluatorCard: true,
};

function seedStep(): DashboardStep {
  const first = DEFAULT_STEPS[0];
  if (!first) throw new Error('DEFAULT_STEPS is empty');
  return first;
}

function draftWith(partial: Partial<DashboardDraft>): DashboardDraft {
  return {
    sections: SECTIONS,
    steps: DEFAULT_STEPS,
    quickMaterials: [],
    cycleCloseLabel: 'May 15',
    ...partial,
  };
}

describe('validateQuickMaterials', () => {
  it('rejects the blank card that "Add link" creates', () => {
    const blank: DashboardQuickMaterial = { label: '', sub: '', icon: 'doc', url: '' };
    const errors = validateQuickMaterials([blank]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      tab: 'materials',
      itemIndex: 0,
      field: 'label',
      message: 'Required.',
    });
    expect(errors[0]?.cardLabel).toBe('Link 1 (untitled)');
  });

  it('treats a whitespace-only label as blank', () => {
    const errors = validateQuickMaterials([{ label: '   ', sub: '', icon: 'doc', url: '' }]);
    expect(errors.map((e) => e.field)).toEqual(['label']);
  });

  it('passes complete materials', () => {
    expect(
      validateQuickMaterials([
        { label: 'Rubric', sub: 'Domains 2 & 3', icon: 'rubric', url: 'https://x.test/a' },
        { label: 'Handbook', sub: '', icon: 'folder', url: '' },
      ]),
    ).toEqual([]);
  });

  it('reports the right index and a length message for an over-long subtitle', () => {
    const errors = validateQuickMaterials([
      { label: 'ok', sub: '', icon: 'doc', url: '' },
      { label: 'ok', sub: 'a'.repeat(201), icon: 'doc', url: '' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ itemIndex: 1, field: 'sub' });
    expect(errors[0]?.message).toMatch(/200/);
    expect(errors[0]?.cardLabel).toBe('ok');
  });

  it('collapses several issues on one field to a single error', () => {
    const errors = validateQuickMaterials([
      { label: 'ok', sub: '', icon: 'nope' as DashboardQuickMaterial['icon'], url: '' },
    ]);
    expect(errors.filter((e) => e.field === 'icon')).toHaveLength(1);
  });
});

describe('validateSteps', () => {
  it('passes the seed steps', () => {
    expect(validateSteps(DEFAULT_STEPS)).toEqual([]);
  });

  it('carries the step id so the editor can address a sorted list', () => {
    const bad = { ...dashboardStep.parse({ id: 'x' }), title: 'a'.repeat(161) };
    const errors = validateSteps([seedStep(), bad]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ tab: 'steps', itemIndex: 1, itemId: 'x', field: 'title' });
  });

  it('rejects an empty id', () => {
    const errors = validateSteps([{ ...dashboardStep.parse({ id: 'x' }), id: '' }]);
    expect(errors[0]).toMatchObject({ field: 'id', message: 'Required.' });
  });
});

describe('validateLayout', () => {
  it('flags an over-long cycle close label at the page level', () => {
    const errors = validateLayout(SECTIONS, 'x'.repeat(51));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ tab: 'layout', itemIndex: -1, field: 'cycleCloseLabel' });
  });

  it('passes the defaults', () => {
    expect(validateLayout(SECTIONS, 'May 15')).toEqual([]);
  });
});

describe('validateDashboardDraft + describeValidationFailure', () => {
  it('orders errors layout → steps → materials and names the first card', () => {
    const errors = validateDashboardDraft(
      draftWith({
        cycleCloseLabel: 'x'.repeat(51),
        quickMaterials: [{ label: '', sub: '', icon: 'doc', url: '' }],
      }),
    );
    expect(errors.map((e) => e.tab)).toEqual(['layout', 'materials']);
    const msg = describeValidationFailure(errors);
    expect(msg).toContain('Not saved');
    expect(msg).toContain('Layout');
    expect(msg).toContain('Cycle close date');
    expect(msg).toContain('(1 more)');
  });

  it('returns an empty string when there is nothing to report', () => {
    expect(describeValidationFailure([])).toBe('');
  });
});

describe('findFieldError', () => {
  const errors = validateDashboardDraft(
    draftWith({
      steps: [{ ...seedStep(), chipLabel: 'a'.repeat(41) }],
      quickMaterials: [
        { label: 'ok', sub: '', icon: 'doc', url: '' },
        { label: '', sub: '', icon: 'doc', url: '' },
      ],
    }),
  );

  it('matches materials by index', () => {
    expect(findFieldError(errors, { itemIndex: 1, field: 'label' })).toBe('Required.');
    expect(findFieldError(errors, { itemIndex: 0, field: 'label' })).toBeUndefined();
  });

  it('matches steps by id', () => {
    expect(findFieldError(errors, { itemId: 'signup', field: 'chipLabel' })).toMatch(/40/);
    expect(findFieldError(errors, { itemId: 'signup', field: 'title' })).toBeUndefined();
  });

  it('is safe with no errors', () => {
    expect(findFieldError(undefined, { itemIndex: 0, field: 'label' })).toBeUndefined();
  });
});
