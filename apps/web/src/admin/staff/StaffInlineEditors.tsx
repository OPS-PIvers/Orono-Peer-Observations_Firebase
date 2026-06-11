import {
  type Building,
  type ModuleDoc,
  type PillColorName,
  type Role,
  type Staff,
  staffHasModule,
  staffMatchesAutoEnable,
} from '@ops/shared';
import { PillSelect, PillMultiSelect, type PillOption } from '@/admin/_shared/PillEditor';
import {
  ADMIN_PILL_COLOR,
  STATUS_PILL_COLOR,
  YEAR_PILL_COLOR,
  colorClasses,
  paletteFor,
} from '@/admin/_shared/pillColors';
import { MODULE_COLOR_CLASSES } from '@/admin/modules/ModulesPage';
import {
  CYCLE_STATUSES,
  cycleStatus,
  cycleStatusLabel,
  displayYear,
  encodeYearStatus,
} from './staffCycle';

type StaffRow = Staff & { id: string };

/** Auto-save callback: merge a partial patch into a staff doc. */
export type PatchStaff = (email: string, patch: Partial<Staff>) => void;

/** Sentinel option value for the "Admin Console Access" toggle in Module Access. */
const ADMIN_ACCESS = '__admin_access__';

export function NameEmailCell({ row }: { row: StaffRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{row.name}</div>
      <div className="text-muted-foreground truncate text-xs">{row.email}</div>
    </div>
  );
}

export function RolePill({
  row,
  roles,
  onPatch,
}: {
  row: StaffRow;
  roles: Role[];
  onPatch: PatchStaff;
}) {
  const known = roles.some((r) => r.roleId === row.role);
  const options: PillOption[] = roles.map((r) => ({
    value: r.roleId,
    label: r.displayName,
    color: colorClasses(r.color) ?? paletteFor(r.roleId),
  }));
  if (!known && row.role) options.unshift({ value: row.role, label: `⚠ ${row.role} (unmapped)` });
  return (
    <PillSelect
      value={row.role}
      options={options}
      onChange={(v) => onPatch(row.email, { role: v })}
      ariaLabel={`Role for ${row.name}`}
      menuLabel="Role"
    />
  );
}

export function StatusPill({ row, onPatch }: { row: StaffRow; onPatch: PatchStaff }) {
  const current = cycleStatus(row.year, row.summativeYear);
  const options: PillOption[] = CYCLE_STATUSES.map((s) => ({
    value: s,
    label: cycleStatusLabel(s),
    color: STATUS_PILL_COLOR[s],
  }));
  return (
    <PillSelect
      value={current}
      options={options}
      onChange={(v) =>
        onPatch(
          row.email,
          encodeYearStatus(displayYear(row.year), v as (typeof CYCLE_STATUSES)[number]),
        )
      }
      ariaLabel={`Status for ${row.name}`}
      menuLabel="Status"
    />
  );
}

export function YearPill({
  row,
  onPatch,
  yearColors,
}: {
  row: StaffRow;
  onPatch: PatchStaff;
  yearColors?: Partial<Record<1 | 2 | 3, PillColorName | undefined>>;
}) {
  const current = displayYear(row.year);
  const options: PillOption[] = [1, 2, 3].map((y) => {
    const yy = y as 1 | 2 | 3;
    return {
      value: String(y),
      label: String(y),
      color: colorClasses(yearColors?.[yy]) ?? YEAR_PILL_COLOR[yy],
    };
  });
  return (
    <PillSelect
      value={String(current)}
      options={options}
      onChange={(v) =>
        onPatch(
          row.email,
          encodeYearStatus(Number(v) as 1 | 2 | 3, cycleStatus(row.year, row.summativeYear)),
        )
      }
      ariaLabel={`Year for ${row.name}`}
      menuLabel="Year"
    />
  );
}

export function BuildingsPill({
  row,
  buildings,
  onPatch,
}: {
  row: StaffRow;
  buildings: Pick<Building, 'displayName' | 'color'>[];
  onPatch: PatchStaff;
}) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
  const assigned = row.buildings ?? [];
  const selected = new Set(assigned);
  const configuredNames = new Set(buildings.map((b) => b.displayName));
  const options: PillOption[] = [
    ...buildings.map((b) => ({
      value: b.displayName,
      label: b.displayName,
      color: colorClasses(b.color) ?? paletteFor(b.displayName),
    })),
    // Assigned-but-unconfigured (legacy/unmapped) names still get a chip + a
    // toggle row so they can be removed.
    ...assigned
      .filter((n) => !configuredNames.has(n))
      .map((n) => ({ value: n, label: n, color: paletteFor(n) })),
  ];
  function toggle(name: string) {
    const next = selected.has(name) ? assigned.filter((b) => b !== name) : [...assigned, name];
    onPatch(row.email, { buildings: next });
  }
  return (
    <PillMultiSelect
      selected={selected}
      options={options}
      onToggle={toggle}
      ariaLabel={`Buildings for ${row.name}`}
      menuLabel="Buildings"
      stack
    />
  );
}

export function ModuleAccessPill({
  row,
  modules,
  onPatch,
}: {
  row: StaffRow;
  modules: ModuleDoc[];
  onPatch: PatchStaff;
}) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
  const assignedModules = row.modules ?? [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
  const exclusions = row.moduleExclusions ?? [];

  const selected = new Set<string>();
  if (row.hasAdminAccess) selected.add(ADMIN_ACCESS);
  for (const m of modules) {
    if (staffHasModule(row, m)) selected.add(m.moduleId);
  }

  const options: PillOption[] = [
    { value: ADMIN_ACCESS, label: 'Admin Console Access', color: ADMIN_PILL_COLOR },
    ...modules.map((m) => {
      const cls = MODULE_COLOR_CLASSES[m.color];
      // A module is "locked" (auto-rule applies and no exclusion) when the rule
      // matches AND the staff member has NOT been excluded. Locked means the pill
      // shows a lock icon in the UI (cannot be freely toggled off without going
      // through the exclusion path).
      const ruleMatches = staffMatchesAutoEnable(row, m.autoEnable ?? null);
      const excluded = exclusions.includes(m.moduleId);
      const locked = ruleMatches && !excluded;
      return {
        value: m.moduleId,
        label: m.displayName,
        color: { bg: cls.bg, text: cls.text },
        ...(locked ? { locked: true } : {}),
      };
    }),
  ];

  function toggle(value: string) {
    if (value === ADMIN_ACCESS) {
      onPatch(row.email, { hasAdminAccess: !row.hasAdminAccess });
      return;
    }
    const mod = modules.find((m) => m.moduleId === value);
    if (!mod) return;

    const ruleMatches = staffMatchesAutoEnable(row, mod.autoEnable ?? null);
    const currentlyExcluded = exclusions.includes(value);
    const currentlyManual = assignedModules.includes(value);

    if (ruleMatches) {
      if (!currentlyExcluded) {
        // Rule is active and not excluded → toggling OFF adds an exclusion.
        onPatch(row.email, { moduleExclusions: [...exclusions, value] });
      } else {
        // Rule is active but excluded → toggling ON removes the exclusion
        // (staff re-enters the auto-enabled cohort).
        onPatch(row.email, {
          moduleExclusions: exclusions.filter((id) => id !== value),
        });
      }
      return;
    }

    // No auto-enable rule — toggle the manual modules array as before.
    const next = currentlyManual
      ? assignedModules.filter((m) => m !== value)
      : [...assignedModules, value];
    onPatch(row.email, { modules: next });
  }

  return (
    <PillMultiSelect
      selected={selected}
      options={options}
      onToggle={toggle}
      ariaLabel={`Module access for ${row.name}`}
      menuLabel="Module access"
    />
  );
}
