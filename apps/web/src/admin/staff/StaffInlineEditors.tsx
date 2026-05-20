import { Check, ChevronDown } from 'lucide-react';
import { OBSERVATION_YEARS, isStaffYear, type ModuleDoc, type Role, type Staff } from '@ops/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MODULE_COLOR_CLASSES } from '@/admin/modules/ModulesPage';

type StaffRow = Staff & { id: string };

/** Auto-save callback: merge a partial patch into a staff doc. */
export type PatchStaff = (email: string, patch: Partial<Staff>) => void;

const INLINE_SELECT =
  'border-input bg-background h-9 w-full rounded-md border px-2 text-sm focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden';

export function RoleCell({
  row,
  roles,
  onPatch,
}: {
  row: StaffRow;
  roles: Role[];
  onPatch: PatchStaff;
}) {
  const known = roles.some((r) => r.roleId === row.role);
  return (
    <select
      className={INLINE_SELECT}
      value={row.role}
      onChange={(e) => onPatch(row.email, { role: e.target.value })}
      aria-label={`Role for ${row.name}`}
    >
      {!known && row.role ? <option value={row.role}>⚠ {row.role} (unmapped)</option> : null}
      {roles.map((r) => (
        <option key={r.roleId} value={r.roleId}>
          {r.displayName}
        </option>
      ))}
    </select>
  );
}

export function YearCell({ row, onPatch }: { row: StaffRow; onPatch: PatchStaff }) {
  return (
    <select
      className={INLINE_SELECT}
      value={row.year}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (isStaffYear(n)) onPatch(row.email, { year: n });
      }}
      aria-label={`Year for ${row.name}`}
    >
      {OBSERVATION_YEARS.map((y) => (
        <option key={y} value={y}>
          {y < 4 ? `Year ${String(y)}` : `Probationary ${String(y - 3)}`}
        </option>
      ))}
    </select>
  );
}

export function StatusCell({ row, onPatch }: { row: StaffRow; onPatch: PatchStaff }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={row.isActive ? 'text-green-700' : 'text-muted-foreground'}
      onClick={() => onPatch(row.email, { isActive: !row.isActive })}
      aria-label={`Toggle active for ${row.name}`}
    >
      {row.isActive ? 'Active' : 'Inactive'}
    </Button>
  );
}

export function BuildingsCell({
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
  function toggle(name: string) {
    const next = assigned.includes(name) ? assigned.filter((b) => b !== name) : [...assigned, name];
    onPatch(row.email, { buildings: next });
  }
  const label =
    assigned.length === 0
      ? 'None'
      : assigned.length <= 2
        ? assigned.join(', ')
        : `${String(assigned.length)} buildings`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between font-normal">
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>Buildings</DropdownMenuLabel>
        {buildingNames.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-xs">No buildings configured</div>
        ) : (
          buildingNames.map((name) => (
            <DropdownMenuCheckboxItem
              key={name}
              checked={assigned.includes(name)}
              onCheckedChange={() => toggle(name)}
              onSelect={(e) => e.preventDefault()}
            >
              {name}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PermissionsCell({
  row,
  modules,
  onPatch,
}: {
  row: StaffRow;
  modules: ModuleDoc[];
  onPatch: PatchStaff;
}) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
  const assigned = row.modules ?? [];
  function toggleModule(moduleId: string) {
    const next = assigned.includes(moduleId)
      ? assigned.filter((m) => m !== moduleId)
      : [...assigned, moduleId];
    onPatch(row.email, { modules: next });
  }

  const chips: string[] = [];
  if (row.hasAdminAccess) chips.push('Admin');
  if (row.summativeYear) chips.push('Summative');
  const moduleNames = new Map(modules.map((m) => [m.moduleId, m.displayName]));
  for (const id of assigned) chips.push(moduleNames.get(id) ?? id);
  const label =
    chips.length === 0
      ? 'None'
      : chips.length <= 2
        ? chips.join(', ')
        : `${String(chips.length)} set`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between font-normal">
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>Permissions</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={row.hasAdminAccess}
          onCheckedChange={() => onPatch(row.email, { hasAdminAccess: !row.hasAdminAccess })}
          onSelect={(e) => e.preventDefault()}
        >
          Admin access
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={row.summativeYear}
          onCheckedChange={() => onPatch(row.email, { summativeYear: !row.summativeYear })}
          onSelect={(e) => e.preventDefault()}
        >
          Summative year
        </DropdownMenuCheckboxItem>
        {modules.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Modules</DropdownMenuLabel>
            {modules.map((m) => (
              <DropdownMenuCheckboxItem
                key={m.moduleId}
                checked={assigned.includes(m.moduleId)}
                onCheckedChange={() => toggleModule(m.moduleId)}
                onSelect={(e) => e.preventDefault()}
              >
                {m.displayName}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Read-only chips for the Permissions column in view mode. */
export function PermissionsChips({ row, modules }: { row: StaffRow; modules: ModuleDoc[] }) {
  const moduleById = new Map(modules.map((m) => [m.moduleId, m]));
  const items: { key: string; label: string; cls?: { bg: string; text: string } }[] = [];
  if (row.hasAdminAccess) items.push({ key: 'admin', label: 'Admin' });
  if (row.summativeYear) items.push({ key: 'summative', label: 'Summative' });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
  for (const id of row.modules ?? []) {
    const mod = moduleById.get(id);
    items.push({
      key: id,
      label: mod?.displayName ?? id,
      ...(mod ? { cls: MODULE_COLOR_CLASSES[mod.color] } : {}),
    });
  }
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => (
        <span
          key={it.key}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
            it.cls ? `${it.cls.bg} ${it.cls.text}` : 'bg-accent text-accent-foreground'
          }`}
        >
          {it.cls ? null : <Check className="h-3 w-3" />}
          {it.label}
        </span>
      ))}
    </div>
  );
}
