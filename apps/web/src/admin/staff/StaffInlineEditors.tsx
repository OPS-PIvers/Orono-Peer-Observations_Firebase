import {
  type Building,
  type ModuleDoc,
  type PillColorName,
  type Role,
  type Staff,
  type StaffYear,
  effectiveModuleIdsFor,
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
import { yearLabel } from '@/utils/staffFormatting';
import {
  CYCLE_STATUSES,
  STAFF_YEARS,
  type CycleStatus,
  cycleStatusFields,
  cycleStatusLabel,
  displayYear,
  staffCycleStatus,
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

/** Status and Year are independent: this pill writes only the status (and
 *  its synced summativeYear), never the year. */
export function StatusPill({ row, onPatch }: { row: StaffRow; onPatch: PatchStaff }) {
  const current = staffCycleStatus(row);
  const options: PillOption[] = CYCLE_STATUSES.map((s) => ({
    value: s,
    label: cycleStatusLabel(s),
    color: STATUS_PILL_COLOR[s],
  }));
  return (
    <PillSelect
      value={current}
      options={options}
      onChange={(v) => onPatch(row.email, cycleStatusFields(v as CycleStatus))}
      ariaLabel={`Status for ${row.name}`}
      menuLabel="Status"
    />
  );
}

/** All six stored years (Y1-Y3, P1-P3). Writes only `year`, never the
 *  status. A P-year takes its display year's color. */
export function YearPill({
  row,
  onPatch,
  yearColors,
}: {
  row: StaffRow;
  onPatch: PatchStaff;
  yearColors?: Partial<Record<1 | 2 | 3, PillColorName | undefined>>;
}) {
  const options: PillOption[] = STAFF_YEARS.map((y) => {
    const dy = displayYear(y);
    return {
      value: String(y),
      label: yearLabel(y),
      color: colorClasses(yearColors?.[dy]) ?? YEAR_PILL_COLOR[dy],
    };
  });
  return (
    <PillSelect
      value={String(row.year)}
      options={options}
      onChange={(v) => onPatch(row.email, { year: Number(v) as StaffYear })}
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

  const selected = new Set<string>(effectiveModuleIdsFor(row, modules));
  if (row.hasAdminAccess) selected.add(ADMIN_ACCESS);

  const options: PillOption[] = [
    { value: ADMIN_ACCESS, label: 'Admin Console Access', color: ADMIN_PILL_COLOR },
    ...modules.map((m) => {
      const cls = MODULE_COLOR_CLASSES[m.color];
      const auto = staffMatchesAutoEnable(row, m.autoEnable ?? null);
      return {
        value: m.moduleId,
        label: m.displayName,
        color: { bg: cls.bg, text: cls.text },
        ...(auto ? { locked: true } : {}),
      };
    }),
  ];

  function toggle(value: string) {
    if (value === ADMIN_ACCESS) {
      onPatch(row.email, { hasAdminAccess: !row.hasAdminAccess });
      return;
    }
    // Rule-matched (auto) modules can't be manually removed — the rule wins.
    const mod = modules.find((m) => m.moduleId === value);
    if (mod && staffMatchesAutoEnable(row, mod.autoEnable ?? null)) return;
    const next = assignedModules.includes(value)
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
