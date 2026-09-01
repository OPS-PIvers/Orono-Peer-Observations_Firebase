import { describe, expect, it } from 'vitest';
import type { Staff } from '@ops/shared';
import { buildBulkEditPlan, describeBulkEditPlan, type BulkEditValues } from './BulkEditDialog';

type Row = Staff & { id: string };

function row(email: string, over: Partial<Staff> = {}): Row {
  return {
    id: email,
    email,
    name: email,
    role: 'teacher',
    year: 1,
    buildings: [],
    modules: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    ...over,
  } as Row;
}

const values: BulkEditValues = {
  year: 2,
  roleId: 'coach',
  building: 'OMS',
  moduleId: 'mints',
  boolValue: true,
};

describe('buildBulkEditPlan', () => {
  it('refuses to plan until the field has a value', () => {
    expect(buildBulkEditPlan('role', { ...values, roleId: '' }, [row('a@x')])).toEqual({
      kind: 'incomplete',
      message: 'Pick a role.',
    });
    expect(buildBulkEditPlan('addBuilding', { ...values, building: '' }, [row('a@x')])).toEqual({
      kind: 'incomplete',
      message: 'Pick a building.',
    });
    expect(buildBulkEditPlan('addModule', { ...values, moduleId: '' }, [row('a@x')])).toEqual({
      kind: 'incomplete',
      message: 'Pick a module.',
    });
  });

  it('patches every selected row for the whole-value fields', () => {
    const plan = buildBulkEditPlan('year', values, [row('a@x'), row('b@x')]);
    expect(plan).toMatchObject({ kind: 'ready', skipped: 0 });
    if (plan.kind !== 'ready') throw new Error('expected ready');
    expect(plan.patches.size).toBe(2);
    expect(plan.patches.get('a@x')).toEqual({ year: 2 });
  });

  it('skips rows that already have the building — the count must not promise a write', () => {
    const plan = buildBulkEditPlan('addBuilding', values, [
      row('has@x', { buildings: ['OMS'] }),
      row('missing@x', { buildings: ['OHS'] }),
    ]);
    if (plan.kind !== 'ready') throw new Error('expected ready');
    expect(plan.patches.size).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(plan.patches.get('missing@x')).toEqual({ buildings: ['OHS', 'OMS'] });
  });

  it('removes a building only from rows that have it, leaving the others untouched', () => {
    const plan = buildBulkEditPlan('removeBuilding', values, [
      row('has@x', { buildings: ['OMS', 'OHS'] }),
      row('without@x', { buildings: ['OHS'] }),
    ]);
    if (plan.kind !== 'ready') throw new Error('expected ready');
    expect(plan.patches.size).toBe(1);
    expect(plan.patches.get('has@x')).toEqual({ buildings: ['OHS'] });
  });

  it('treats a missing modules array as empty — Firestore reads bypass Zod defaults', () => {
    const legacy = row('legacy@x');
    delete (legacy as Partial<Staff>).modules;
    const plan = buildBulkEditPlan('addModule', values, [legacy]);
    if (plan.kind !== 'ready') throw new Error('expected ready');
    expect(plan.patches.get('legacy@x')).toEqual({ modules: ['mints'] });
  });

  it('plans nothing when every selected row already matches', () => {
    const plan = buildBulkEditPlan('addModule', values, [row('a@x', { modules: ['mints'] })]);
    expect(plan).toMatchObject({ kind: 'ready', skipped: 1 });
    if (plan.kind !== 'ready') throw new Error('expected ready');
    expect(plan.patches.size).toBe(0);
  });
});

describe('describeBulkEditPlan', () => {
  it('counts the selection while the field is still unset', () => {
    expect(describeBulkEditPlan({ kind: 'incomplete', message: 'Pick a role.' }, 224)).toBe(
      '224 staff members selected.',
    );
  });

  it('claims only the rows it will write', () => {
    const plan = buildBulkEditPlan('year', values, [row('a@x'), row('b@x')]);
    expect(describeBulkEditPlan(plan, 2)).toBe('Applying to 2 staff members.');
  });

  it('names the skipped rows rather than over-promising', () => {
    const plan = buildBulkEditPlan('addBuilding', values, [
      row('has@x', { buildings: ['OMS'] }),
      row('missing@x'),
    ]);
    expect(describeBulkEditPlan(plan, 2)).toBe(
      'Applying to 1 of 2 staff members selected — the other 1 already match and will be skipped.',
    );
  });

  it('says plainly when there is nothing to write', () => {
    const plan = buildBulkEditPlan('addBuilding', values, [row('has@x', { buildings: ['OMS'] })]);
    expect(describeBulkEditPlan(plan, 1)).toBe(
      'All 1 staff member selected already match — nothing to write.',
    );
  });
});
