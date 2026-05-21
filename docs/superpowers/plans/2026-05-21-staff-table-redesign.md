# Staff Table Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Staff table's Edit/Done dropdown mode with always-clickable pills that open anchored popovers, move email under the name, restructure columns (Name · Role · Buildings · Status · Year · Module Access · kebab), and replace the Active/Inactive column with an archive workflow — with no data-model migration.

**Architecture:** A reusable `PillEditor` (single + multi variants) built on the existing Radix `DropdownMenu`. Year [1-3] + Status [Low/High/Probationary] are a presentation layer over the existing `staff.year` (1-6) + `staff.summativeYear` via pure `staffCycle` helpers. Module Access folds modules + an "Admin Console Access" toggle (`hasAdminAccess`). Archive reuses `isActive` (the default filter already hides `isActive=false`).

**Tech Stack:** React 19 + Vite + Tailwind v4; Radix `DropdownMenu`; Vitest. Auto-save via `setDoc(..., {merge:true})` (existing `patchStaff`).

---

## Critical conventions

- Auto-save partial patches via the existing `PatchStaff` callback (`StaffPage` already defines `patchStaff(email, patch)` → `setDoc merge`).
- Firestore reads bypass Zod defaults: guard `row.modules ?? []` / `row.buildings ?? []` with `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition`.
- Pills sit inside rows that have `onRowClick` (opens `StaffDialog`). Every pill trigger MUST `stopPropagation()` so clicking it doesn't open the dialog.
- Verify with `pnpm typecheck` (repo) + scoped `pnpm exec eslint <file>` (full `pnpm lint` is noisy with pre-existing CRLF warnings in unrelated dirs). Run `pnpm --filter @ops/web test` for the staffCycle unit tests. Run `prettier --write` on changed files before committing.
- `DropdownMenu` exports in use: `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` (closes on select — single), `DropdownMenuCheckboxItem` (use `onSelect={(e)=>e.preventDefault()}` to stay open — multi), `DropdownMenuLabel`, `DropdownMenuSeparator`.

## File structure

- Create `apps/web/src/admin/staff/staffCycle.ts` + `staffCycle.test.ts` — pure year/status encoding.
- Create `apps/web/src/admin/_shared/PillEditor.tsx` — `SinglePillEditor` + `MultiPillEditor`.
- Rewrite `apps/web/src/admin/staff/StaffInlineEditors.tsx` — pill cells.
- Modify `apps/web/src/admin/staff/StaffPage.tsx` — columns, Select toggle, kebab, filter logic.
- Modify `apps/web/src/admin/staff/StaffFilterBar.tsx` — status `inactive`→`archived` relabel.

---

# WAVE A — Independent foundation (Tasks 1 & 2 run in PARALLEL; new files, no existing consumers)

### Task 1: `staffCycle` encoding helpers (TDD)

**Files:**

- Create: `apps/web/src/admin/staff/staffCycle.ts`
- Create: `apps/web/src/admin/staff/staffCycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/admin/staff/staffCycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CYCLE_STATUSES,
  cycleStatus,
  cycleStatusLabel,
  displayYear,
  encodeYearStatus,
} from './staffCycle';

describe('displayYear', () => {
  it('passes continuing years through and maps probationary 4-6 to 1-3', () => {
    expect(displayYear(1)).toBe(1);
    expect(displayYear(3)).toBe(3);
    expect(displayYear(4)).toBe(1);
    expect(displayYear(6)).toBe(3);
  });
});

describe('cycleStatus', () => {
  it('is probationary for year >= 4 regardless of summative', () => {
    expect(cycleStatus(4, false)).toBe('probationary');
    expect(cycleStatus(6, true)).toBe('probationary');
  });
  it('is high when summative, low otherwise, for continuing years', () => {
    expect(cycleStatus(2, true)).toBe('high');
    expect(cycleStatus(2, false)).toBe('low');
  });
});

describe('encodeYearStatus', () => {
  it('encodes low/high as the same year with summative false/true', () => {
    expect(encodeYearStatus(2, 'low')).toEqual({ year: 2, summativeYear: false });
    expect(encodeYearStatus(2, 'high')).toEqual({ year: 2, summativeYear: true });
  });
  it('encodes probationary as year + 3, summative true', () => {
    expect(encodeYearStatus(1, 'probationary')).toEqual({ year: 4, summativeYear: true });
    expect(encodeYearStatus(3, 'probationary')).toEqual({ year: 6, summativeYear: true });
  });
  it('round-trips through display + cycleStatus', () => {
    for (let y = 1; y <= 6; y++) {
      for (const s of [true, false]) {
        const enc = encodeYearStatus(displayYear(y), cycleStatus(y, s));
        expect(displayYear(enc.year)).toBe(displayYear(y));
        expect(cycleStatus(enc.year, enc.summativeYear)).toBe(cycleStatus(y, s));
      }
    }
  });
});

describe('labels', () => {
  it('exposes the three statuses with human labels', () => {
    expect(CYCLE_STATUSES).toEqual(['low', 'high', 'probationary']);
    expect(cycleStatusLabel('low')).toBe('Low Cycle');
    expect(cycleStatusLabel('high')).toBe('High Cycle');
    expect(cycleStatusLabel('probationary')).toBe('Probationary');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ops/web test staffCycle`
Expected: FAIL — `Cannot find module './staffCycle'`.

- [ ] **Step 3: Implement `staffCycle.ts`**

Create `apps/web/src/admin/staff/staffCycle.ts`:

```ts
import type { StaffYear } from '@ops/shared';

export const CYCLE_STATUSES = ['low', 'high', 'probationary'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

const LABELS: Record<CycleStatus, string> = {
  low: 'Low Cycle',
  high: 'High Cycle',
  probationary: 'Probationary',
};

export function cycleStatusLabel(status: CycleStatus): string {
  return LABELS[status];
}

/** Stored years 1-3 are continuing; 4-6 are probationary P1-P3. Both display as 1-3. */
export function displayYear(year: number): 1 | 2 | 3 {
  const d = year >= 4 ? year - 3 : year;
  return (d < 1 ? 1 : d > 3 ? 3 : d) as 1 | 2 | 3;
}

export function cycleStatus(year: number, summativeYear: boolean): CycleStatus {
  if (year >= 4) return 'probationary';
  return summativeYear ? 'high' : 'low';
}

/** Encode a chosen display-year (1-3) + status back into stored fields. */
export function encodeYearStatus(
  year: 1 | 2 | 3,
  status: CycleStatus,
): { year: StaffYear; summativeYear: boolean } {
  if (status === 'probationary') return { year: (year + 3) as StaffYear, summativeYear: true };
  return { year, summativeYear: status === 'high' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ops/web test staffCycle`
Expected: PASS.

> **Wave A note:** Do NOT commit — the controller commits Wave A after both Task 1 and Task 2 land and the repo typechecks. Report files written + test result.

---

### Task 2: `PillEditor` component (single + multi)

**Files:**

- Create: `apps/web/src/admin/_shared/PillEditor.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/src/admin/_shared/PillEditor.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface PillOption {
  value: string;
  label: string;
}

const PILL_TRIGGER =
  'inline-flex max-w-full items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-accent focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden';

/** A single-select pill: shows the selected label, opens a checkmarked menu. */
export function SinglePillEditor({
  value,
  options,
  onChange,
  ariaLabel,
  menuLabel,
  pill,
}: {
  value: string;
  options: PillOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  menuLabel?: string;
  /** Custom pill content; defaults to the selected option's label. */
  pill?: ReactNode;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={PILL_TRIGGER}
        >
          <span className="truncate">{pill ?? selected?.label ?? value}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {menuLabel ? <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel> : null}
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)}>
            <Check
              className={cn('mr-2 h-4 w-4', o.value === value ? 'opacity-100' : 'opacity-0')}
            />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A multi-select pill row: renders `pills`, opens a checkbox menu that stays open. */
export function MultiPillEditor({
  selectedValues,
  options,
  onToggle,
  ariaLabel,
  menuLabel,
  pills,
  emptyLabel = 'None',
}: {
  selectedValues: ReadonlySet<string>;
  options: PillOption[];
  onToggle: (value: string) => void;
  ariaLabel: string;
  menuLabel?: string;
  /** Pill content (chips); when empty, `emptyLabel` shows instead. */
  pills?: ReactNode;
  emptyLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={cn(PILL_TRIGGER, 'flex-wrap')}
        >
          <span className="flex flex-wrap items-center gap-1">
            {selectedValues.size > 0 ? (
              pills
            ) : (
              <span className="text-muted-foreground">{emptyLabel}</span>
            )}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {menuLabel ? <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel> : null}
        {options.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-xs">Nothing to choose.</div>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selectedValues.has(o.value)}
              onCheckedChange={() => onToggle(o.value)}
              onSelect={(e) => e.preventDefault()}
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

> **Wave A note:** Do NOT commit (controller commits Wave A). Report file written. (Can't unit-test a UI component standalone; the controller typechecks after.)

---

# WAVE B — Integration (single agent; depends on Wave A)

### Task 3: Pill-based staff cells

**Files:**

- Rewrite: `apps/web/src/admin/staff/StaffInlineEditors.tsx`

Replace the entire file with pill-based cells. (The old `RoleCell`/`YearCell`/`StatusCell`/`BuildingsCell`/`PermissionsCell`/`PermissionsChips` exports are removed and replaced.)

- [ ] **Step 1: Rewrite `StaffInlineEditors.tsx`**

```tsx
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck` — Expected: PASS once Task 4 updates `StaffPage` imports (do Task 4 before typechecking, or expect transient errors about removed exports). Defer the green check to end of Task 4.

---

### Task 4: StaffPage columns, Select toggle, kebab, archive filter + StaffFilterBar relabel

**Files:**

- Modify: `apps/web/src/admin/staff/StaffPage.tsx`
- Modify: `apps/web/src/admin/staff/StaffFilterBar.tsx`

- [ ] **Step 1: Relabel the status filter (`StaffFilterBar.tsx`)**

Change the `StatusFilter` type and its menu so `inactive` becomes `archived`:

- Line 17: `export type StatusFilter = 'all' | 'active' | 'archived';`
- In the Status `DropdownMenuContent`, replace the options array and labels:

```tsx
{
  (['active', 'archived', 'all'] as const).map((s) => (
    <DropdownMenuCheckboxItem
      key={s}
      checked={filters.status === s}
      onCheckedChange={() => update('status', s)}
      onSelect={(e) => e.preventDefault()}
    >
      {s === 'active' ? 'Active' : s === 'archived' ? 'Archived' : 'All'}
    </DropdownMenuCheckboxItem>
  ));
}
```

- Update the Status `FilterChip` `activeSummary` to: `filters.status === 'all' ? 'All' : filters.status === 'archived' ? 'Archived' : null`.

(`EMPTY_FILTERS.status` stays `'active'` — archived hidden by default.)

- [ ] **Step 2: Update `StaffPage.tsx` imports + filter logic**

- Replace the inline-editor imports with the new pill cells:

```tsx
import {
  BuildingsPill,
  ModuleAccessPill,
  NameEmailCell,
  RolePill,
  StatusPill,
  YearPill,
  type PatchStaff,
} from './StaffInlineEditors';
```

- In the `filtered` useMemo, change the status branch from `inactive` to `archived`:

```tsx
if (filters.status === 'active' && !s.isActive) return false;
if (filters.status === 'archived' && s.isActive) return false;
```

- Remove `editMode` state and the search-by-email note stays (search still matches email via `s.email`).

- [ ] **Step 3: Replace the columns**

Replace the `columns` useMemo with the new column set (Name+email, Role, Buildings, Status, Year, Module Access). Status/Year/etc. cells are always the pill editors:

```tsx
const columns: ColumnDef<StaffRow>[] = useMemo(
  () => [
    {
      key: 'name',
      header: 'Name',
      sortAccessor: (r) => r.name,
      cell: (r) => <NameEmailCell row={r} />,
      mobile: { primary: true },
    },
    {
      key: 'role',
      header: 'Role',
      sortAccessor: (r) => roleLabelByRoleId.get(r.role) ?? r.role,
      cell: (r) => <RolePill row={r} roles={roles} onPatch={patchStaff} />,
    },
    {
      key: 'buildings',
      header: 'Buildings',
      sortAccessor: (r) => r.buildings.join(', '),
      cell: (r) => <BuildingsPill row={r} buildingNames={buildingNames} onPatch={patchStaff} />,
    },
    {
      key: 'status',
      header: 'Status',
      headClassName: 'w-36',
      sortAccessor: (r) => (r.summativeYear ? 1 : 0),
      cell: (r) => <StatusPill row={r} onPatch={patchStaff} />,
    },
    {
      key: 'year',
      header: 'Year',
      headClassName: 'w-20',
      sortAccessor: (r) => r.year,
      cell: (r) => <YearPill row={r} onPatch={patchStaff} />,
    },
    {
      key: 'moduleAccess',
      header: 'Module Access',
      sortAccessor: (r) =>
        (r.hasAdminAccess ? 1 : 0) +
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults
        (r.modules ?? []).length,
      cell: (r) => <ModuleAccessPill row={r} modules={modules} onPatch={patchStaff} />,
    },
  ],
  [roleLabelByRoleId, roles, buildingNames, modules, patchStaff],
);
```

(Drop the old `email` and active-`status` columns. Remove the now-unused `Badge`, `yearLabel` imports if no longer referenced.)

- [ ] **Step 4: Replace Edit mode with a Select toggle + update the AdminDataView usage**

- Rename the `editMode` state to `selectMode` (`const [selectMode, setSelectMode] = useState(false);`).
- Header actions: the toggle button label becomes "Select"/"Done"; keep "Add staff".

```tsx
<Button
  variant={selectMode ? 'default' : 'outline'}
  onClick={() => {
    setSelectMode((m) => !m);
    setSelected(new Set());
  }}
>
  {selectMode ? <Check /> : <ListChecks />}
  {selectMode ? 'Done' : 'Select'}
</Button>
```

(Import `ListChecks` from `lucide-react`; keep `Check`.)

- In `<AdminDataView>`, drop the `editing` prop. Gate selection on `selectMode`; when not selecting, rows open the dialog:

```tsx
<AdminDataView
  columns={columns}
  rows={loading && !staff ? null : sortedRows}
  loading={loading}
  rowKey={(r) => r.email}
  empty={filters.search ? 'No staff match that search.' : 'No staff yet.'}
  {...(selectMode
    ? { selection: { selected, onToggleRow: toggleRow, onToggleAll: toggleAll } }
    : { onRowClick: (r: StaffRow) => setEditing(r) })}
  sort={sort}
  onSortChange={setSort}
  rowActions={(r) => <RowActions row={r} onEdit={() => setEditing(r)} onPatch={patchStaff} />}
/>
```

- [ ] **Step 5: Kebab menu — Edit / Archive / Restore / Copy email**

Replace `RowActions` at the bottom of the file:

```tsx
function RowActions({
  row,
  onEdit,
  onPatch,
}: {
  row: StaffRow;
  onEdit: () => void;
  onPatch: PatchStaff;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 min-h-9 w-9 min-w-9"
          aria-label={`Actions for ${row.name}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>Edit staff member</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(row.email);
          }}
        >
          Copy email
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {row.isActive ? (
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => onPatch(row.email, { isActive: false })}
          >
            Archive staff member
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onPatch(row.email, { isActive: true })}>
            Restore staff member
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 6: Verify**

Run: `pnpm typecheck` → PASS. Run `pnpm exec eslint apps/web/src/admin/staff/StaffPage.tsx apps/web/src/admin/staff/StaffInlineEditors.tsx apps/web/src/admin/staff/StaffFilterBar.tsx apps/web/src/admin/_shared/PillEditor.tsx apps/web/src/admin/staff/staffCycle.ts` → zero warnings on these files. Run `pnpm --filter @ops/web test staffCycle` → PASS. `prettier --write` the changed files.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/admin/staff/StaffInlineEditors.tsx apps/web/src/admin/staff/StaffPage.tsx apps/web/src/admin/staff/StaffFilterBar.tsx
git commit -m "feat(staff): pill+popover inline editing, email under name, archive workflow"
```

---

# WAVE C — Verify & push

### Task 5: Final verification and push

- [ ] **Step 1:** `pnpm typecheck && pnpm --filter @ops/web test` → PASS.
- [ ] **Step 2:** Scoped `prettier --check` on all changed files; `prettier --write` + amend the relevant commit if anything is unformatted (committed content must be LF-clean for CI).
- [ ] **Step 3:** Browser smoke test (preview): each of Role/Status/Year/Buildings/Module Access opens a popover and auto-saves; Year shows 1-3 and Status shows Low/High/Probationary; Admin Console Access toggles inside Module Access; kebab Archive removes a row from the default list and the Archived filter + Restore brings it back; Select toggle shows checkboxes and bulk edit still works; clicking a row (not a pill) opens the dialog.
- [ ] **Step 4:** `git push origin dev-paul`.

---

## Self-review

**Spec coverage:** email-under-name (Task 3 NameEmailCell + Task 4 columns) ✓; pills+popovers no edit mode (Task 2 + Task 4 Select toggle) ✓; Role/Status/Year/Buildings/Module Access pills (Task 3) ✓; Year[1-3]+Status[Low/High/Prob] no-migration encoding (Task 1) ✓; Module Access = modules + admin access (Task 3 ModuleAccessPill) ✓; archive replaces Active/Inactive (Task 4 kebab + filter relabel) ✓; kebab Edit opens dialog (Task 4) ✓; reusable PillEditor (Task 2) ✓; Staff-only scope ✓.

**Placeholder scan:** none.

**Type consistency:** `PatchStaff` reused from StaffInlineEditors; `CycleStatus`/`encodeYearStatus`/`displayYear`/`cycleStatus`/`cycleStatusLabel`/`CYCLE_STATUSES` consistent across Task 1 + Task 3; `SinglePillEditor`/`MultiPillEditor`/`PillOption` props match between Task 2 and Task 3 usage; `StatusFilter` values (`active`/`archived`/`all`) consistent between Task 4 Step 1 (FilterBar) and Step 2 (StaffPage filter logic).
