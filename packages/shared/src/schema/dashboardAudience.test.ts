import { describe, expect, it } from 'vitest';
import {
  dashboardMaterialAudience,
  emptyAudience,
  hasStaleAudienceChips,
  isEveryoneAudience,
  staffMatchesAudience,
  staleAudienceChips,
  type AudienceStaff,
  type DashboardMaterialAudience,
} from './dashboardAudience.js';
import { dashboardQuickMaterial } from './dashboard.js';
import type { ModuleAssignmentModule } from './module.js';

function person(partial: Partial<AudienceStaff> = {}): AudienceStaff {
  return {
    year: 1,
    summativeYear: false,
    role: 'teacher',
    buildings: ['High School'],
    modules: [],
    ...partial,
  };
}

function rule(partial: Partial<DashboardMaterialAudience>): DashboardMaterialAudience {
  return { ...emptyAudience(), ...partial };
}

const MODULES: ModuleAssignmentModule[] = [
  { moduleId: 'mentor', autoEnable: null },
  { moduleId: 'planning-cohort', autoEnable: { dimension: 'status', value: 'planning' } },
];

describe('dashboardMaterialAudience schema', () => {
  it('defaults every dimension to empty', () => {
    expect(dashboardMaterialAudience.parse({})).toEqual(emptyAudience());
  });

  it('is applied to quick materials by default (back-compat for old docs)', () => {
    const m = dashboardQuickMaterial.parse({ label: 'Rubric' });
    expect(m.audience).toEqual(emptyAudience());
    expect(isEveryoneAudience(m.audience)).toBe(true);
  });

  it('accepts the retired "low" status in storage but rejects unknown ones', () => {
    expect(dashboardMaterialAudience.parse({ cycleStatuses: ['low'] }).cycleStatuses).toEqual([
      'low',
    ]);
    expect(() => dashboardMaterialAudience.parse({ cycleStatuses: ['medium'] })).toThrow();
    expect(() => dashboardMaterialAudience.parse({ years: [7] })).toThrow();
  });
});

describe('staffMatchesAudience', () => {
  it('matches everyone when the audience is empty or missing', () => {
    expect(staffMatchesAudience(person(), emptyAudience())).toBe(true);
    expect(staffMatchesAudience(person(), undefined)).toBe(true);
  });

  it('ORs within a dimension', () => {
    const r = rule({ years: [1, 2] });
    expect(staffMatchesAudience(person({ year: 1 }), r)).toBe(true);
    expect(staffMatchesAudience(person({ year: 2 }), r)).toBe(true);
    expect(staffMatchesAudience(person({ year: 3 }), r)).toBe(false);
  });

  it('ANDs across dimensions: a chip in a new dimension narrows', () => {
    const r = rule({ years: [1, 2], buildings: ['OMS'] });
    expect(staffMatchesAudience(person({ year: 1, buildings: ['OMS'] }), r)).toBe(true);
    expect(staffMatchesAudience(person({ year: 1, buildings: ['High School'] }), r)).toBe(false);
    expect(staffMatchesAudience(person({ year: 3, buildings: ['OMS'] }), r)).toBe(false);
  });

  it('matches years by the stored value, so probationary P1 (4) is not year 1', () => {
    const r = rule({ years: [1] });
    expect(staffMatchesAudience(person({ year: 4 }), r)).toBe(false);
    expect(staffMatchesAudience(person({ year: 4 }), rule({ years: [4] }))).toBe(true);
  });

  it('matches cycle statuses via the derived phase', () => {
    expect(staffMatchesAudience(person({ year: 1 }), rule({ cycleStatuses: ['planning'] }))).toBe(
      true,
    );
    expect(staffMatchesAudience(person({ year: 2 }), rule({ cycleStatuses: ['developing'] }))).toBe(
      true,
    );
    expect(
      staffMatchesAudience(
        person({ year: 3, summativeYear: true }),
        rule({ cycleStatuses: ['high'] }),
      ),
    ).toBe(true);
    expect(
      staffMatchesAudience(person({ year: 5 }), rule({ cycleStatuses: ['probationary'] })),
    ).toBe(true);
    expect(staffMatchesAudience(person({ year: 5 }), rule({ cycleStatuses: ['planning'] }))).toBe(
      false,
    );
  });

  it('widens a stored legacy "low" to planning-or-developing', () => {
    const r = rule({ cycleStatuses: ['low'] });
    expect(staffMatchesAudience(person({ year: 1 }), r)).toBe(true);
    expect(staffMatchesAudience(person({ year: 2 }), r)).toBe(true);
    expect(staffMatchesAudience(person({ year: 3, summativeYear: true }), r)).toBe(false);
    expect(staffMatchesAudience(person({ year: 4 }), r)).toBe(false);
  });

  it('matches buildings on any overlap with staff.buildings', () => {
    const r = rule({ buildings: ['OMS', 'Schumann'] });
    expect(staffMatchesAudience(person({ buildings: ['High School', 'OMS'] }), r)).toBe(true);
    expect(staffMatchesAudience(person({ buildings: ['High School'] }), r)).toBe(false);
    expect(staffMatchesAudience(person({ buildings: [] }), r)).toBe(false);
  });

  it('matches roles by exact roleId', () => {
    const r = rule({ roles: ['counselor'] });
    expect(staffMatchesAudience(person({ role: 'counselor' }), r)).toBe(true);
    expect(staffMatchesAudience(person({ role: 'teacher' }), r)).toBe(false);
  });

  it('matches modules against the effective set (manual plus auto-enable)', () => {
    const r = rule({ modules: ['planning-cohort'] });
    // Year-1 non-summative = planning, so auto-enabled into the cohort.
    expect(staffMatchesAudience(person({ year: 1 }), r, { modules: MODULES })).toBe(true);
    expect(staffMatchesAudience(person({ year: 2 }), r, { modules: MODULES })).toBe(false);
    // Manual assignment counts too.
    expect(
      staffMatchesAudience(person({ year: 2, modules: ['planning-cohort'] }), r, {
        modules: MODULES,
      }),
    ).toBe(true);
    // Without module docs only the manual list is consulted.
    expect(staffMatchesAudience(person({ year: 1 }), r)).toBe(false);
  });

  it('fails open on a stale building chip instead of hiding from everyone', () => {
    const r = rule({ buildings: ['Old Name'] });
    // No known list supplied: strict.
    expect(staffMatchesAudience(person(), r)).toBe(false);
    // Known list supplied and the chip is not in it: dimension unconstrained.
    expect(staffMatchesAudience(person(), r, { knownBuildings: ['High School'] })).toBe(true);
    // A live chip alongside a stale one still constrains.
    const mixed = rule({ buildings: ['Old Name', 'OMS'] });
    expect(
      staffMatchesAudience(person({ buildings: ['High School'] }), mixed, {
        knownBuildings: ['High School', 'OMS'],
      }),
    ).toBe(false);
    expect(
      staffMatchesAudience(person({ buildings: ['OMS'] }), mixed, {
        knownBuildings: ['High School', 'OMS'],
      }),
    ).toBe(true);
  });

  it('fails open on stale role and module chips', () => {
    expect(
      staffMatchesAudience(person(), rule({ roles: ['gone'] }), { knownRoles: ['teacher'] }),
    ).toBe(true);
    expect(staffMatchesAudience(person(), rule({ modules: ['gone'] }), { modules: MODULES })).toBe(
      true,
    );
  });
});

describe('staleAudienceChips', () => {
  it('reports chips absent from the supplied known lists only', () => {
    const stale = staleAudienceChips(
      rule({ buildings: ['OMS', 'Gone'], roles: ['teacher', 'nope'], modules: ['mentor', 'x'] }),
      { knownBuildings: ['OMS'], knownRoles: ['teacher'], modules: MODULES },
    );
    expect(stale).toEqual({ buildings: ['Gone'], roles: ['nope'], modules: ['x'] });
    expect(hasStaleAudienceChips(stale)).toBe(true);
  });

  it('reports nothing for dimensions whose list is not loaded', () => {
    const stale = staleAudienceChips(rule({ buildings: ['Gone'], roles: ['nope'] }), {});
    expect(hasStaleAudienceChips(stale)).toBe(false);
  });
});
