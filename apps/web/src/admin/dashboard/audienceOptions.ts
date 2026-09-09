import {
  AUDIENCE_YEARS,
  CYCLE_STATUSES,
  isEveryoneAudience,
  type Building,
  type CycleStatus,
  type DashboardMaterialAudience,
  type ModuleDoc,
  type Role,
  type StaffYear,
  type StoredCycleStatus,
} from '@ops/shared';
import { yearLabel } from '@/utils/staffFormatting';
import { AUD_EVERYONE } from './copyStrings';

/**
 * Option lists and labels for the audience picker and the "Preview as"
 * popover. Both need the same vocabulary, and the collapsed summary line
 * on each material card needs to render stored values (role ids, building
 * names) back into words.
 */

export interface AudienceOptions {
  roles: readonly Role[];
  buildings: readonly Building[];
  modules: readonly ModuleDoc[];
}

export const EMPTY_AUDIENCE_OPTIONS: AudienceOptions = { roles: [], buildings: [], modules: [] };

/** Stored year 1-3 = continuing; 4-6 = probationary P1-P3. The picker has
 *  to say which is which because both display as "Year 1-3" elsewhere. */
export function audienceYearLabel(year: StaffYear): string {
  return year < 4 ? `Year ${String(year)}` : `Probationary ${String(year - 3)}`;
}

/** Short form for the collapsed summary line. */
export function audienceYearShort(year: StaffYear): string {
  return year < 4 ? `Year ${String(year)}` : yearLabel(year);
}

export const CYCLE_STATUS_LABELS: Record<StoredCycleStatus, string> = {
  planning: 'Planning',
  developing: 'Developing',
  high: 'High cycle',
  probationary: 'Probationary',
  /** Retired; never offered, still rendered if an old doc carries it. */
  low: 'Planning or Developing (legacy)',
};

export const YEAR_OPTIONS: readonly StaffYear[] = AUDIENCE_YEARS;
export const CYCLE_STATUS_OPTIONS: readonly CycleStatus[] = CYCLE_STATUSES;

export function roleLabel(options: AudienceOptions, roleId: string): string {
  return options.roles.find((r) => r.roleId === roleId)?.displayName ?? roleId;
}

export function moduleLabel(options: AudienceOptions, moduleId: string): string {
  return options.modules.find((m) => m.moduleId === moduleId)?.displayName ?? moduleId;
}

/**
 * One line naming the audience: `Everyone`, or the per-dimension groups
 * joined with a middle dot — `Year 1, Year 2 · OMS · Mentor`. Dimensions
 * are ANDed, so the dot reads as "who are also".
 */
export function summarizeAudience(
  audience: DashboardMaterialAudience,
  options: AudienceOptions,
): string {
  if (isEveryoneAudience(audience)) return AUD_EVERYONE;
  const parts: string[] = [];
  if (audience.years.length > 0) {
    parts.push(
      [...audience.years]
        .sort((a, b) => a - b)
        .map(audienceYearShort)
        .join(', '),
    );
  }
  if (audience.cycleStatuses.length > 0) {
    parts.push(audience.cycleStatuses.map((s) => CYCLE_STATUS_LABELS[s]).join(', '));
  }
  if (audience.buildings.length > 0) parts.push(audience.buildings.join(', '));
  if (audience.roles.length > 0) {
    parts.push(audience.roles.map((r) => roleLabel(options, r)).join(', '));
  }
  if (audience.modules.length > 0) {
    parts.push(audience.modules.map((m) => moduleLabel(options, m)).join(', '));
  }
  return parts.join(' · ');
}

export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}
