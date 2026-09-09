import { z } from 'zod';
import { OBSERVATION_YEARS } from '../constants.js';
import { LEGACY_CYCLE_STATUS, STORED_CYCLE_STATUSES, cycleStatus } from '../cycle.js';
import { effectiveModuleIdsFor, type ModuleAssignmentModule } from './module.js';
import { staffYear, type Staff } from './staff.js';

/**
 * Audience rule for a dashboard quick material — which staff see the card.
 *
 * Five dimensions. **OR within a dimension, AND across dimensions**: a rule
 * of `{years: [1, 2], buildings: ['OMS']}` reads "a year-1 or year-2 person
 * who is also at OMS". An empty dimension is unconstrained, and a rule with
 * every dimension empty means everyone — which is also the zod default, so
 * materials saved before this field existed keep showing to everyone with
 * no migration. This mirrors the staff list's filter bar exactly.
 *
 * Reference formats follow how staff docs already store each thing:
 *   - `years`         stored `staff.year` (1-3 continuing, 4-6 probationary
 *                     P1-P3). The picker labels 4-6 as "Probationary N"
 *                     because they *display* as years 1-3 elsewhere.
 *   - `cycleStatuses` the derived phase (`cycleStatus()`); the retired
 *                     `'low'` stays parseable and widens to planning-or-
 *                     developing, as `staffMatchesAutoEnable` does.
 *   - `buildings`     building `displayName`, as `staff.buildings` holds.
 *   - `roles`         `roleId` slug, as `staff.role` holds.
 *   - `modules`       `moduleId`, matched against the staff member's
 *                     *effective* set (manual ∪ auto-enable).
 *
 * This is a display filter only. `dashboardQuickMaterials/global` stays
 * domain-readable; the rule decides which cards render, not who can fetch
 * the document.
 */

export const dashboardMaterialAudience = z.object({
  years: z.array(staffYear).default([]),
  cycleStatuses: z.array(z.enum(STORED_CYCLE_STATUSES)).default([]),
  buildings: z.array(z.string().trim().min(1).max(80)).default([]),
  roles: z.array(z.string().trim().min(1).max(80)).default([]),
  modules: z.array(z.string().trim().min(1).max(80)).default([]),
});
export type DashboardMaterialAudience = z.infer<typeof dashboardMaterialAudience>;

export const AUDIENCE_DIMENSIONS = [
  'years',
  'cycleStatuses',
  'buildings',
  'roles',
  'modules',
] as const;
export type AudienceDimension = (typeof AUDIENCE_DIMENSIONS)[number];

export function emptyAudience(): DashboardMaterialAudience {
  return { years: [], cycleStatuses: [], buildings: [], roles: [], modules: [] };
}

/** True when no dimension constrains anything — the material is for everyone. */
export function isEveryoneAudience(
  audience: DashboardMaterialAudience | null | undefined,
): boolean {
  if (!audience) return true;
  return AUDIENCE_DIMENSIONS.every((d) => audience[d].length === 0);
}

/** The staff fields the matcher reads. `modules` is optional because
 *  Firestore reads bypass the zod default on older docs. */
export type AudienceStaff = Pick<Staff, 'year' | 'summativeYear' | 'role' | 'buildings'> & {
  modules?: readonly string[];
};

/**
 * What the matcher needs beyond the staff doc. Every field is optional so
 * a caller that hasn't loaded a list yet (or a test that doesn't care)
 * gets strict matching on that dimension; once a list is supplied, chips
 * naming nothing in it are ignored — see `staleAudienceChips`.
 */
export interface AudienceContext {
  /** All module docs — needed for the effective-module union and for
   *  pruning stale module chips. */
  modules?: readonly ModuleAssignmentModule[] | null | undefined;
  /** Every building `displayName` that currently exists. */
  knownBuildings?: readonly string[] | null | undefined;
  /** Every `roleId` that currently exists. */
  knownRoles?: readonly string[] | null | undefined;
}

export interface StaleAudienceChips {
  buildings: string[];
  roles: string[];
  modules: string[];
}

/**
 * Chips that name a building, role or module that no longer exists (deleted
 * or renamed). Dimensions whose known list wasn't supplied report nothing.
 */
export function staleAudienceChips(
  audience: DashboardMaterialAudience,
  ctx: AudienceContext,
): StaleAudienceChips {
  const known = (list: readonly string[] | null | undefined, chips: readonly string[]) =>
    list ? chips.filter((c) => !list.includes(c)) : [];
  return {
    buildings: known(ctx.knownBuildings, audience.buildings),
    roles: known(ctx.knownRoles, audience.roles),
    modules: known(ctx.modules ? ctx.modules.map((m) => m.moduleId) : null, audience.modules),
  };
}

export function hasStaleAudienceChips(stale: StaleAudienceChips): boolean {
  return stale.buildings.length + stale.roles.length + stale.modules.length > 0;
}

/**
 * Does this staff member fall inside the audience?
 *
 * **Stale chips fail open.** Under AND-across, honouring a chip for a
 * building someone renamed would hide the material from *everyone*,
 * silently. So a chip naming nothing in the supplied known list is dropped
 * before matching, and a dimension left with no live chips stops
 * constraining. The admin editor flags the stale chip on the card instead.
 */
export function staffMatchesAudience(
  staff: AudienceStaff,
  audience: DashboardMaterialAudience | null | undefined,
  ctx: AudienceContext = {},
): boolean {
  if (!audience) return true;
  const stale = staleAudienceChips(audience, ctx);
  const live = (chips: readonly string[], dead: readonly string[]) =>
    chips.filter((c) => !dead.includes(c));

  if (audience.years.length > 0 && !audience.years.includes(staff.year)) return false;

  if (audience.cycleStatuses.length > 0) {
    const status = cycleStatus(staff.year, staff.summativeYear);
    const ok = audience.cycleStatuses.some((s) =>
      s === LEGACY_CYCLE_STATUS ? status === 'planning' || status === 'developing' : s === status,
    );
    if (!ok) return false;
  }

  const buildings = live(audience.buildings, stale.buildings);
  if (buildings.length > 0 && !staff.buildings.some((b) => buildings.includes(b))) return false;

  const roles = live(audience.roles, stale.roles);
  if (roles.length > 0 && !roles.includes(staff.role)) return false;

  const modules = live(audience.modules, stale.modules);
  if (modules.length > 0) {
    const effective = effectiveModuleIdsFor(staff, ctx.modules);
    if (!modules.some((m) => effective.includes(m))) return false;
  }

  return true;
}

/** The six stored years the picker offers, in order. */
export const AUDIENCE_YEARS = OBSERVATION_YEARS;
