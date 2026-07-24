# Staff Table Redesign — Design

**Date:** 2026-05-21
**Status:** Approved (design); pending implementation plan

## Goal

Make the admin Staff table cleaner and faster to edit: move email under the
name to reclaim width, replace the clunky Edit/Done dropdown mode with
always-clickable **pills that open anchored popovers**, restructure the columns,
and replace the Active/Inactive column with an **archive** workflow — all
without a data-model migration.

## Constraints & decisions

- **No schema migration.** The new **Year [1|2|3]** + **Status [Low Cycle |
  High Cycle | Probationary]** toggles are a _presentation layer_ over the
  existing `staff.year` (1–6) + `staff.summativeYear` (boolean) fields.
  Everything downstream (role-year mappings keyed `${roleId}_${year}` over
  `OBSERVATION_YEARS = [1..6]`, rubric assignment, dashboard `yearTierLabelFor`,
  checkpoints) keeps working unchanged.
- **Archive reuses `isActive`.** Archiving sets `isActive=false` and hides the
  row from the default list; no new field. Permanent deletion of long-archived
  staff is a separate future job (out of scope).
- **No new dependency.** The pill popovers are built on the existing Radix
  `DropdownMenu` (already powers the working Buildings/Modules multi-selects),
  not a new Popover library.
- **Scope: the Staff table only.** The pill-editor component is built reusably
  so other admin tables can adopt it later, but no other table changes here.
- Presentational/behavioral only otherwise — no changes to observations,
  scheduling, claims, or rules.

## Current state (context)

- `apps/web/src/admin/staff/StaffPage.tsx` — columns: Name, Email, Role, Year,
  Buildings, Permissions, Status; an `editMode` toggle swaps every cell for a
  full-width control and shows bulk-select checkboxes; row click opens
  `StaffDialog`.
- `apps/web/src/admin/staff/StaffInlineEditors.tsx` — `RoleCell`/`YearCell` use
  native `<select>` (the cut-off controls); `BuildingsCell`/`PermissionsCell`
  use `DropdownMenu` checkbox multi-selects; `StatusCell` toggles `isActive`;
  `PermissionsChips` renders read-only chips (Admin / Summative / module
  colors). The "Permissions" column bundles `hasAdminAccess`, `summativeYear`,
  and `modules`.
- `apps/web/src/admin/staff/StaffFilterBar.tsx` — search + Role/Year/Building/
  Status filters (`EMPTY_FILTERS`, `StaffFilters`).
- `apps/web/src/admin/_shared/AdminDataView.tsx` — supports `editing` + per-
  column `editCell`, and a `selection` prop (checkbox column).
- `apps/web/src/utils/staffFormatting.ts` — `yearLabel`.

## Design

### 1. Columns

Left → right: **Name** (email muted, smaller, on a second line) · **Role** ·
**Buildings** · **Status** · **Year** · **Module Access** · **⋮ kebab**.

The old standalone Active/Inactive column is removed; "Status" now means cycle
status. The `email` column is removed as its own column (rendered under Name).

### 2. Pill + popover interaction (replaces Edit/Done mode)

- Every editable value renders as a **pill** in the normal (non-edit) table.
- Clicking a pill opens an **anchored popover** (DropdownMenu) for that field;
  the click `stopPropagation()`s so it does not trigger the row's dialog.
- **Single-select** popovers: Role, Status, Year (radio-style items; selecting
  closes the popover and auto-saves).
- **Multi-select** popovers: Buildings, Module Access (checkbox items;
  click-away / Done closes; auto-saves on each toggle — matching today's
  `BuildingsCell`).
- Clicking elsewhere on a row still opens the full **Edit dialog**
  (`StaffDialog`).
- The `editMode` toggle + per-cell `editCell` swapping is removed. A new
  **"Select" toggle** (replacing the "Edit" button) shows the bulk-select
  checkbox column and keeps the existing `BulkEditBar` / `BulkEditDialog`
  flow. When Select is off, pills are interactive and rows open the dialog.

### 3. Reusable `PillEditor`

New component `apps/web/src/admin/_shared/PillEditor.tsx` built on
`DropdownMenu`:

- **Single variant:** props `{ value, options: {value,label}[], onChange,
renderPill?, ariaLabel }`. Renders one pill (the selected label) that opens a
  radio-style menu.
- **Multi variant:** props `{ values: string[], options, onChange(next),
renderPills?, emptyLabel, ariaLabel }`. Renders a row of pills (or an
  empty-state pill like "None") that opens a checkbox menu; toggling calls
  `onChange` with the next array (auto-save).
- Pills use the existing Badge/rounded-chip styling; module pills keep their
  `MODULE_COLOR_CLASSES` colors.

### 4. Year + Status encoding (the no-migration core)

Add pure helpers (new `apps/web/src/admin/staff/staffCycle.ts`, unit-tested):

```ts
export type CycleStatus = 'low' | 'high' | 'probationary';

// display
export function displayYear(year: number): 1 | 2 | 3; // year<=3 ? year : year-3
export function cycleStatus(year: number, summativeYear: boolean): CycleStatus;
//   year>=4 -> 'probationary'; else summativeYear ? 'high' : 'low'

// write back to the stored fields
export function encodeYearStatus(
  displayYear: 1 | 2 | 3,
  status: CycleStatus,
): { year: StaffYear; summativeYear: boolean };
//   low  -> { year: d,   summativeYear: false }
//   high -> { year: d,   summativeYear: true  }
//   prob -> { year: d+3, summativeYear: true  }
```

- **Status pill** labels: `Low Cycle` / `High Cycle` / `Probationary`
  (single-select). Editing writes both `year` and `summativeYear` via
  `encodeYearStatus(displayYear(row.year), chosenStatus)`.
- **Year pill** labels: `1` / `2` / `3` (single-select). Editing writes via
  `encodeYearStatus(chosenYear, cycleStatus(row.year, row.summativeYear))`.
- "Summative" is relabeled "High Cycle" only in this table's pills; the stored
  field stays `summativeYear`. (Broader rename elsewhere is out of scope.)

### 5. Module Access column

Multi-select popover whose options are: a top **"Admin Console Access"** toggle
(reads/writes `hasAdminAccess`) followed by all active modules (writes the
`modules` array). Pills: an "Admin" pill when `hasAdminAccess`, plus a colored
pill per assigned module. Empty → a muted "None" pill that still opens the
popover. `summativeYear` is NOT here anymore (it moved to Status).

### 6. Archive workflow (replaces the Active/Inactive column)

- **Kebab menu** per row: **Edit staff member** (opens `StaffDialog` — the only
  place `name`/`email` are edited) and **Archive staff member** (sets
  `isActive=false`).
- The table **filters out archived (`isActive=false`) staff by default.**
- `StaffFilterBar`'s Status filter becomes **Active (default) / Archived / All**.
  In the Archived view, the kebab offers **Restore** (sets `isActive=true`).
- Subtitle count reflects the active filter.
- Permanent auto-delete of long-archived staff = separate future cleanup
  function (explicitly out of scope; noted for later).

### 7. Name cell

Renders `name` (medium weight) with `email` beneath in `text-xs
text-muted-foreground`. Sort by name unchanged. The kebab's "Copy email" action
is retained.

## Components touched

- New: `apps/web/src/admin/_shared/PillEditor.tsx`,
  `apps/web/src/admin/staff/staffCycle.ts` (+ `staffCycle.test.ts`).
- Rewritten: `StaffInlineEditors.tsx` → pill-based cells (`RolePill`,
  `StatusPill`, `YearPill`, `BuildingsPill`, `ModuleAccessPill`,
  `NameEmailCell`), dropping the native `<select>` editors and the read-only
  `PermissionsChips` (folded into pills).
- Modified: `StaffPage.tsx` (column set, remove edit mode → Select toggle,
  kebab Archive/Edit/Restore, default archived filter), `StaffFilterBar.tsx`
  (Active/Archived/All status filter).
- Possibly simplified: `AdminDataView.tsx` `editing`/`editCell` usage for Staff
  (cells are always the pill editors now; selection still via `selection` prop).

## Success criteria

- Email shows under the name; rows are visibly less cramped.
- Each of Role, Status, Year, Buildings, Module Access is a clickable pill that
  opens an anchored popover and auto-saves; no Edit/Done mode.
- Year shows 1–3 and Status shows Low/High/Probationary, correctly round-
  tripping to the stored `year`/`summativeYear` with no migration and no change
  to role-year mappings or dashboard behavior.
- "Admin Console Access" is a toggle inside the Module Access popover and drives
  `hasAdminAccess`.
- Archiving hides a staff member from the default list; an Archived filter +
  Restore brings them back; bulk select still works via the Select toggle.
- Editing name/email happens only in the dialog (kebab → Edit, or row click).

## Out of scope

- Any change to `staff.year` / `summativeYear` / `isActive` schema, or to
  observations, scheduling, claims, or security rules.
- A permanent-delete / auto-cleanup job for archived staff (future).
- Applying the pill-editor pattern to other admin tables.
- Renaming "Summative" → "High Cycle" outside the Staff table.
- A dedicated Popover primitive (we reuse `DropdownMenu`).

## Rollout

1. `PillEditor` + `staffCycle` helpers (+ tests).
2. Pill-based staff cells + Name/email cell.
3. StaffPage column set, Select toggle, kebab (Edit/Archive/Restore), default
   archived filter; StaffFilterBar status options.
4. Verify in browser; typecheck + lint + format; push to dev-paul.
