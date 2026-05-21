# Module Auto-Enable — Design

**Date:** 2026-05-21
**Status:** Approved (pending spec review)

## Problem

Modules (participation tracks like Mentor, MINTS, ILT) are assigned to staff
manually, one person at a time, via the Module Access pill in the Staff table.
Cohorts that are defined by evaluation state — e.g. "everyone currently in their
High Cycle year" — have to be re-assigned by hand every time staff cycle in and
out of that state. That is tedious and drifts out of date.

A stray `modules/high-cycle` document (created 2026-05-20 as a manual stand-in
for this idea) has already been deleted. This feature replaces that pattern with
a real rule.

## Goal

Let an admin configure a module to **auto-enable** for staff who match a single
evaluation-state criterion, so membership tracks staff state automatically with
no manual upkeep. Manual assignment still works on top of the rule.

## Requirements (from brainstorming)

- **Targeting:** a module auto-enables on exactly **one** dimension — either one
  cycle **status** (`low` / `high` / `probationary`) **or** one display **year**
  (`1` / `2` / `3`). Never a combination, never multiple values.
- **Manual interaction:** "auto + manual additions." Effective membership is the
  union of (a) staff matching the rule and (b) staff manually assigned. A
  rule-matched staff member **cannot** be manually removed (the rule wins); a
  non-matching staff member **can** be manually added.
- **Enforcement:** correct everywhere members are surfaced — dashboard chips,
  sidebar nav, the Module Access pill — **and** in Firestore security rules,
  which gate module-page item reads.

## Non-goals (YAGNI)

- Multi-value criteria (e.g. status ∈ {high, probationary}).
- Combining status AND year in one rule.
- Per-person exclusion overrides (force-removing a rule-matched staff member).
- A Cloud Function / materialized membership field.

## Data model

Add one field to `moduleDoc` (`packages/shared/src/schema/module.ts`):

```ts
autoEnable:
  | null                                                        // manual-only (default)
  | { dimension: 'status'; value: 'low' | 'high' | 'probationary' }
  | { dimension: 'year';   value: 1 | 2 | 3 }
```

Modeled as a Zod nullable discriminated union, defaulting to `null`. Existing
module docs lack the field; all consumers treat missing/undefined as `null`
(Firestore reads bypass Zod defaults, per the existing codebase convention).

### Cycle logic moves to shared

The pure cycle-state functions currently in
`apps/web/src/admin/staff/staffCycle.ts` are domain logic, and now three
consumers need them (the schema's status enum, the membership helper, and the
implicit contract the rules mirror). Move into `@ops/shared`:

- `CYCLE_STATUSES` (`['low','high','probationary']`) and the `CycleStatus` type
- `cycleStatus(year, summativeYear): CycleStatus`
- `displayYear(year): 1 | 2 | 3`

`staffCycle.ts` keeps the **labels** (`'High Cycle'`, etc. — presentation) and
`encodeYearStatus` (table-pill encoding), re-exporting the moved names so
existing web imports keep working. This is a targeted move, not a broad refactor.

### Membership helper (shared)

```ts
staffMatchesAutoEnable(
  staff: Pick<Staff, 'year' | 'summativeYear'>,
  autoEnable: AutoEnable | null,
): boolean
```

- `null` → `false`
- `dimension: 'status'` → `cycleStatus(staff.year, staff.summativeYear) === value`
- `dimension: 'year'` → `displayYear(staff.year) === value`

A module's effective membership test for a given staff member is:

```
isMember = module.moduleId ∈ (staff.modules ?? [])      // manual
         || staffMatchesAutoEnable(staff, module.autoEnable)  // rule
```

## UI touchpoints

### 1. Module dialog — `ModulesPage.tsx`

Add an **Auto-enable** control to the create/edit form:

- Mode select: **Off** (default) / **By status** / **By year**.
- When "By status": a second select for Low Cycle / High Cycle / Probationary.
- When "By year": a second select for 1 / 2 / 3.

Form state gains an `autoEnable` value; `save()` persists it (writing `null`
when Off). Help text: "Staff matching this rule get the module automatically;
you can still add others by hand in the Staff table."

### 2. Module Access pill — `StaffInlineEditors.tsx` + `PillEditor.tsx`

`ModuleAccessPill` computes, per staff row, which module options are rule-matched
via `staffMatchesAutoEnable`. For those options the toggle renders **on and
disabled** with a small "Auto" hint; `onToggle` is suppressed. Non-matched
options behave exactly as today (manual add/remove against `staff.modules`).

`PillMultiSelect` / `PillOption` gain an optional `locked?: boolean` (and a short
`lockedHint?`) so `ToggleRow` can render the disabled, forced-on state. The
trigger chips show the effective set (manual ∪ auto). The `Admin Console Access`
sentinel is unaffected.

### 3. Sidebar module nav — `AppSidebar.tsx`

`moduleNavItems` currently filters `allModules` by `assigned = new Set(myStaff.modules)`.
Change `assigned` to effective membership: a module is assigned if its id is in
`myStaff.modules` **or** `staffMatchesAutoEnable(myStaff, m.autoEnable)`. Page +
active filters unchanged.

### 4. Dashboard — `StaffDashboardPage.tsx`

Two spots derive from `staff.modules` and must use effective membership:

- `assignedModuleIds` (line ~100) — drives the `in` query that fetches the
  staff's module materials/progress. Must include auto-matched module ids so a
  matching staff sees the auto module's content. (Effective set stays well under
  the 30-id `in` cap.)
- `moduleChips` (line ~237) — the chip row. Same union.

Both compute the union of `staff.modules` and `modulesData.filter(m =>
staffMatchesAutoEnable(staff, m.autoEnable)).map(m => m.moduleId)`.

### 5. Module page guard — `ModulePage.tsx`

`isAssigned` (line ~44) currently checks `myStaff.modules.includes(moduleId)`.
Extend to also pass when `staffMatchesAutoEnable(myStaff, module.autoEnable)` —
otherwise a rule-matched staff member is blocked at the UI even though rules
grant the underlying reads. (Admin short-circuit unchanged.)

### 6. Delete discoverability — `ModulesPage.tsx`

Surface **Delete** directly in the Modules row-actions dropdown (today it exists
only inside the Edit dialog footer, which is what made the stray module feel
undeletable). The row action opens the existing delete confirmation path; no new
delete logic.

## Firestore rules + tests

Extend the module-items rule (`firestore.rules`, the `/{path=**}/items/{itemId}`
block). Read is granted to a domain staff member when the item's `moduleId` is in
their `modules` array **or** when they satisfy that module's `autoEnable`:

```
allow read: if isAdmin()
  || (isFromOronoDomain() && (
        resource.data.moduleId in staffModules()
        || matchesModuleAutoEnable(resource.data.moduleId)
     ));
```

`matchesModuleAutoEnable(moduleId)` does:

1. `get(/databases/$(db)/documents/modules/$(moduleId)).data.get('autoEnable', null)`
2. `get(/databases/$(db)/documents/staff/$(request.auth.token.email))` for
   `year` / `summativeYear`
3. Inline cycle mapping mirroring the shared helper:
   - `status = year >= 4 ? 'probationary' : (summativeYear ? 'high' : 'low')`
   - `displayYear = year >= 4 ? year - 3 : year` (clamped 1–3)
   - match on `dimension`/`value`.

`get()` results are request-cached, and there are few module docs, so the added
cost is bounded. The same rule already powers both direct gets and the
dashboard's `collectionGroup('items')` query.

**Rules tests** (`pnpm test:rules`):

- status-match staff reads an auto-enabled module's items (not in their array)
- year-match staff reads
- non-matching staff is denied
- manual assignment (in `modules` array) still grants read
- `collectionGroup('items')` returns auto-enabled items for a matching staff
- `autoEnable: null` module denies a non-assigned staff member

## Testing

- **Unit (shared):** `staffMatchesAutoEnable` across status/year/null and the
  probationary edge (`year >= 4`); `cycleStatus` / `displayYear` retain coverage
  after the move.
- **Rules:** as above.
- **Manual / preview:** configure a module's auto-enable; confirm the Staff-table
  pill locks for matching rows and stays toggleable for others; confirm sidebar
  nav and dashboard chips reflect rule membership; confirm a matching staff
  member can open the module page.

## Migration

None. Modules without `autoEnable` behave as manual-only. No backfill; the stray
`modules/high-cycle` doc is already deleted.
