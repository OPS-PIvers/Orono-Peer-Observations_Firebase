import type { ModuleDoc, Role, Staff } from '@ops/shared';
import { SinglePillEditor, MultiPillEditor, type PillOption } from '@/admin/_shared/PillEditor';
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
  const options: PillOption[] = roles.map((r) => ({ value: r.roleId, label: r.displayName }));
  if (!known && row.role) options.unshift({ value: row.role, label: `⚠ ${row.role} (unmapped)` });
  return (
    <SinglePillEditor
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
  }));
  return (
    <SinglePillEditor
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

export function YearPill({ row, onPatch }: { row: StaffRow; onPatch: PatchStaff }) {
  const current = String(displayYear(row.year));
  const options: PillOption[] = [
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
  ];
  return (
    <SinglePillEditor
      value={current}
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
  buildingNames,
  onPatch,
}: {
  row: StaffRow;
  buildingNames: string[];
  onPatch: PatchStaff;
}) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
  const assigned = row.buildings ?? [];
  const selected = new Set(assigned);
  const options: PillOption[] = buildingNames.map((n) => ({ value: n, label: n }));
  function toggle(name: string) {
    const next = selected.has(name) ? assigned.filter((b) => b !== name) : [...assigned, name];
    onPatch(row.email, { buildings: next });
  }
  return (
    <MultiPillEditor
      selectedValues={selected}
      options={options}
      onToggle={toggle}
      ariaLabel={`Buildings for ${row.name}`}
      menuLabel="Buildings"
      pills={assigned.map((b) => (
        <span key={b} className="bg-accent text-accent-foreground rounded-full px-2 py-0.5 text-xs">
          {b}
        </span>
      ))}
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
  const moduleById = new Map(modules.map((m) => [m.moduleId, m]));

  const selected = new Set<string>(assignedModules);
  if (row.hasAdminAccess) selected.add(ADMIN_ACCESS);

  const options: PillOption[] = [
    { value: ADMIN_ACCESS, label: 'Admin Console Access' },
    ...modules.map((m) => ({ value: m.moduleId, label: m.displayName })),
  ];

  function toggle(value: string) {
    if (value === ADMIN_ACCESS) {
      onPatch(row.email, { hasAdminAccess: !row.hasAdminAccess });
      return;
    }
    const next = assignedModules.includes(value)
      ? assignedModules.filter((m) => m !== value)
      : [...assignedModules, value];
    onPatch(row.email, { modules: next });
  }

  const pills = (
    <>
      {row.hasAdminAccess ? (
        <span className="bg-ops-blue text-primary-foreground rounded-full px-2 py-0.5 text-xs">
          Admin
        </span>
      ) : null}
      {assignedModules.map((id) => {
        const mod = moduleById.get(id);
        const cls = mod ? MODULE_COLOR_CLASSES[mod.color] : undefined;
        return (
          <span
            key={id}
            className={`rounded-full px-2 py-0.5 text-xs ${cls ? `${cls.bg} ${cls.text}` : 'bg-accent text-accent-foreground'}`}
          >
            {mod?.displayName ?? id}
          </span>
        );
      })}
    </>
  );

  return (
    <MultiPillEditor
      selectedValues={selected}
      options={options}
      onToggle={toggle}
      ariaLabel={`Module access for ${row.name}`}
      menuLabel="Module access"
      pills={pills}
    />
  );
}
