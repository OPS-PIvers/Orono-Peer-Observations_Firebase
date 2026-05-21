# Module Auto-Enable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin configure a module to auto-enable for staff matching a single cycle-status or display-year criterion, with membership = manual picks ∪ rule matches.

**Architecture:** Add an `autoEnable` field to the module schema and a shared `staffMatchesAutoEnable` helper (built on cycle logic moved into `@ops/shared`). Every place that reads module membership (staff pill, sidebar, dashboard, module page) unions manual `staff.modules` with rule matches. Firestore rules evaluate the same predicate inline so server-side item access stays correct — no Cloud Function, no derived data.

**Tech Stack:** React + TypeScript (Vite), Zod schemas in `@ops/shared`, Firestore security rules, Vitest (unit + `@firebase/rules-unit-testing`).

**Spec:** `docs/superpowers/specs/2026-05-21-module-auto-enable-design.md`

---

## File Structure

- `packages/shared/src/cycle.ts` — **new.** Pure cycle domain logic moved out of web: `CYCLE_STATUSES`, `CycleStatus`, `cycleStatus`, `displayYear`.
- `packages/shared/src/cycle.test.ts` — **new.** Unit tests for the moved logic.
- `packages/shared/src/schema/module.ts` — **modify.** Add `autoEnable` field + `AutoEnable` type + `staffMatchesAutoEnable` helper.
- `packages/shared/src/schema/module.test.ts` — **modify.** Tests for `autoEnable` parsing + `staffMatchesAutoEnable`.
- `packages/shared/src/index.ts` — **modify.** Export `./cycle.js`.
- `apps/web/src/admin/staff/staffCycle.ts` — **modify.** Re-export moved names from `@ops/shared`; keep labels + `encodeYearStatus`.
- `firestore.rules` — **modify.** Helper functions + extend the items read rule.
- `tests/rules/modules.test.ts` — **modify.** Auto-enable access tests.
- `apps/web/src/admin/modules/ModulesPage.tsx` — **modify.** Auto-enable form control + row-menu Delete.
- `apps/web/src/admin/_shared/PillEditor.tsx` — **modify.** `locked` option support.
- `apps/web/src/admin/staff/StaffInlineEditors.tsx` — **modify.** `ModuleAccessPill` auto-match + lock.
- `apps/web/src/components/AppSidebar.tsx` — **modify.** Effective membership for module nav.
- `apps/web/src/dashboard/StaffDashboardPage.tsx` — **modify.** Effective membership for chips + materials query.
- `apps/web/src/modules/ModulePage.tsx` — **modify.** Effective membership for the `isAssigned` guard.

---

## Task 1: Move cycle logic into @ops/shared

**Files:**
- Create: `packages/shared/src/cycle.ts`
- Create: `packages/shared/src/cycle.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the new shared module**

Create `packages/shared/src/cycle.ts`:

```ts
/**
 * Cycle state — pure domain logic shared by the web client, schemas, and
 * (mirrored, by hand) the Firestore security rules.
 *
 * Year encoding (mirrors GAS Constants.js): 1-3 = continuing-contract years;
 * 4-6 = probationary P1-P3, which display as 1-3.
 */

export const CYCLE_STATUSES = ['low', 'high', 'probationary'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/** Stored years 1-3 are continuing; 4-6 are probationary P1-P3. Both display as 1-3. */
export function displayYear(year: number): 1 | 2 | 3 {
  const d = year >= 4 ? year - 3 : year;
  return (d < 1 ? 1 : d > 3 ? 3 : d) as 1 | 2 | 3;
}

export function cycleStatus(year: number, summativeYear: boolean): CycleStatus {
  if (year >= 4) return 'probationary';
  return summativeYear ? 'high' : 'low';
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/shared/src/cycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CYCLE_STATUSES, cycleStatus, displayYear } from './cycle.js';

describe('CYCLE_STATUSES', () => {
  it('is the three statuses in order', () => {
    expect(CYCLE_STATUSES).toEqual(['low', 'high', 'probationary']);
  });
});

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
```

- [ ] **Step 3: Add the export**

In `packages/shared/src/index.ts`, add after the `roles.js` export (line 10):

```ts
export * from './cycle.js';
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @ops/shared test -- cycle`
Expected: PASS (3 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/cycle.ts packages/shared/src/cycle.test.ts packages/shared/src/index.ts
git commit -m "refactor(shared): move cycle status/year logic into @ops/shared"
```

---

## Task 2: Add autoEnable schema + staffMatchesAutoEnable helper

**Files:**
- Modify: `packages/shared/src/schema/module.ts`
- Modify: `packages/shared/src/schema/module.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/schema/module.test.ts`:

```ts
import { autoEnable, moduleDoc, staffMatchesAutoEnable } from './module.js';

describe('autoEnable schema', () => {
  it('parses a status rule', () => {
    expect(autoEnable.parse({ dimension: 'status', value: 'high' })).toEqual({
      dimension: 'status',
      value: 'high',
    });
  });
  it('parses a year rule', () => {
    expect(autoEnable.parse({ dimension: 'year', value: 2 })).toEqual({
      dimension: 'year',
      value: 2,
    });
  });
  it('rejects an unknown status value', () => {
    expect(() => autoEnable.parse({ dimension: 'status', value: 'medium' })).toThrow();
  });
  it('rejects a year outside 1-3', () => {
    expect(() => autoEnable.parse({ dimension: 'year', value: 4 })).toThrow();
  });
  it('defaults moduleDoc.autoEnable to null', () => {
    const parsed = moduleDoc.parse({
      moduleId: 'mentor',
      displayName: 'Mentor',
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.autoEnable).toBeNull();
  });
});

describe('staffMatchesAutoEnable', () => {
  it('returns false for a null/undefined rule', () => {
    expect(staffMatchesAutoEnable({ year: 2, summativeYear: true }, null)).toBe(false);
    expect(staffMatchesAutoEnable({ year: 2, summativeYear: true }, undefined)).toBe(false);
  });
  it('matches on status', () => {
    expect(
      staffMatchesAutoEnable({ year: 2, summativeYear: true }, { dimension: 'status', value: 'high' }),
    ).toBe(true);
    expect(
      staffMatchesAutoEnable({ year: 2, summativeYear: false }, { dimension: 'status', value: 'high' }),
    ).toBe(false);
  });
  it('matches probationary on status for year >= 4', () => {
    expect(
      staffMatchesAutoEnable(
        { year: 5, summativeYear: false },
        { dimension: 'status', value: 'probationary' },
      ),
    ).toBe(true);
  });
  it('matches on display year, including probationary 4-6 -> 1-3', () => {
    expect(
      staffMatchesAutoEnable({ year: 2, summativeYear: false }, { dimension: 'year', value: 2 }),
    ).toBe(true);
    expect(
      staffMatchesAutoEnable({ year: 5, summativeYear: false }, { dimension: 'year', value: 2 }),
    ).toBe(true);
    expect(
      staffMatchesAutoEnable({ year: 1, summativeYear: false }, { dimension: 'year', value: 2 }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @ops/shared test -- module`
Expected: FAIL — `autoEnable` / `staffMatchesAutoEnable` not exported.

- [ ] **Step 3: Implement the schema + helper**

In `packages/shared/src/schema/module.ts`, update the imports at the top:

```ts
import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';
import { PILL_COLORS, pillColor, type PillColorName } from './pillColor.js';
import { CYCLE_STATUSES, cycleStatus, displayYear } from '../cycle.js';
import type { Staff } from './staff.js';
```

Add this block immediately before `export const moduleDoc = z.object({`:

```ts
/**
 * Auto-enable rule: a module can automatically apply to every staff member
 * matching ONE criterion — a cycle status OR a display year (never both, never
 * multiple values). `null` (the default) means manual assignment only.
 */
export const autoEnable = z.discriminatedUnion('dimension', [
  z.object({ dimension: z.literal('status'), value: z.enum(CYCLE_STATUSES) }),
  z.object({
    dimension: z.literal('year'),
    value: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
]);
export type AutoEnable = z.infer<typeof autoEnable>;
```

Inside the `moduleDoc` object, add the field right after `sections` (before `createdAt`):

```ts
  /** When set, the module auto-applies to staff matching this single
   *  criterion, on top of any manual assignments. null = manual-only. */
  autoEnable: autoEnable.nullable().default(null),
```

Add this helper at the end of the file (after `export type ModuleInput`):

```ts
/**
 * Does this staff member satisfy a module's auto-enable rule? Mirrors the
 * inline cycle math in firestore.rules — keep the two in sync (rules tests
 * guard the rules side).
 */
export function staffMatchesAutoEnable(
  staff: Pick<Staff, 'year' | 'summativeYear'>,
  rule: AutoEnable | null | undefined,
): boolean {
  if (!rule) return false;
  if (rule.dimension === 'status') {
    return cycleStatus(staff.year, staff.summativeYear) === rule.value;
  }
  return displayYear(staff.year) === rule.value;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @ops/shared test -- module`
Expected: PASS (all new describe blocks green).

- [ ] **Step 5: Typecheck shared**

Run: `pnpm --filter @ops/shared typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schema/module.ts packages/shared/src/schema/module.test.ts
git commit -m "feat(shared): module autoEnable schema + staffMatchesAutoEnable helper"
```

---

## Task 3: Re-point web staffCycle.ts at shared

**Files:**
- Modify: `apps/web/src/admin/staff/staffCycle.ts`

- [ ] **Step 1: Replace the moved logic with re-exports**

Replace the entire contents of `apps/web/src/admin/staff/staffCycle.ts` with:

```ts
import type { StaffYear } from '@ops/shared';
import { CYCLE_STATUSES, type CycleStatus, cycleStatus, displayYear } from '@ops/shared';

// Cycle status/year logic now lives in @ops/shared; re-exported here so existing
// web imports keep working. Labels + the table-pill encoding stay web-local.
export { CYCLE_STATUSES, cycleStatus, displayYear };
export type { CycleStatus };

const LABELS: Record<CycleStatus, string> = {
  low: 'Low Cycle',
  high: 'High Cycle',
  probationary: 'Probationary',
};

export function cycleStatusLabel(status: CycleStatus): string {
  return LABELS[status];
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

- [ ] **Step 2: Run the existing web test (verifies re-exports + labels + encoding)**

Run: `pnpm --filter @ops/web test -- staffCycle`
Expected: PASS — `apps/web/src/admin/staff/staffCycle.test.ts` is unchanged and still green via the re-exports.

- [ ] **Step 3: Typecheck web**

Run: `pnpm --filter @ops/web typecheck`
Expected: no errors (all `./staffCycle` importers resolve the re-exported names).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/admin/staff/staffCycle.ts
git commit -m "refactor(web): re-export cycle logic from @ops/shared"
```

---

## Task 4: Firestore rules — grant item access on auto-enable match

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/rules/modules.test.ts`

- [ ] **Step 1: Write the failing rules tests**

In `tests/rules/modules.test.ts`, add this `describe` block after the existing
`'/modules/{id}/items …'` block (before the `moduleProgress` block):

```ts
describe('/modules/{id}/items — auto-enable grants access by status/year', () => {
  beforeEach(async () => {
    // high-cycle module: auto-enables for cycle status 'high'
    await seed('modules/high-cycle', {
      moduleId: 'high-cycle',
      displayName: 'High Cycle',
      autoEnable: { dimension: 'status', value: 'high' },
    });
    await seed('modules/high-cycle/items/i1', {
      itemId: 'i1',
      moduleId: 'high-cycle',
      kind: 'material',
      sectionId: 's1',
      title: 'High cycle packet',
    });
    // year2 module: auto-enables for display year 2
    await seed('modules/year2', {
      moduleId: 'year2',
      displayName: 'Year 2',
      autoEnable: { dimension: 'year', value: 2 },
    });
    await seed('modules/year2/items/i2', {
      itemId: 'i2',
      moduleId: 'year2',
      kind: 'material',
      sectionId: 's1',
      title: 'Year 2 task',
    });
    // staff who is high cycle (summative), year 2 — matches both
    await seed('staff/high2@orono.k12.mn.us', { year: 2, summativeYear: true, modules: [] });
    // staff who is low cycle, year 1 — matches neither
    await seed('staff/low1@orono.k12.mn.us', { year: 1, summativeYear: false, modules: [] });
    // probationary staff stored as year 5 (displays as year 2)
    await seed('staff/prob@orono.k12.mn.us', { year: 5, summativeYear: false, modules: [] });
  });

  it('high-cycle staff reads a status-matched module item (not in their array)', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/high-cycle/items/i1')));
  });

  it('year-2 staff reads a year-matched module item', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/year2/items/i2')));
  });

  it('probationary year-5 staff matches display year 2', async () => {
    const db = testEnv.authenticatedContext('p', claims.teacher('prob@orono.k12.mn.us')).firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/year2/items/i2')));
  });

  it('non-matching staff is denied a status-only module item', async () => {
    const db = testEnv.authenticatedContext('l', claims.teacher('low1@orono.k12.mn.us')).firestore();
    await assertFails(getDoc(doc(db, 'modules/high-cycle/items/i1')));
  });

  it('a matching staff can run the dashboard collectionGroup query for the auto module', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(db, 'items'),
          where('kind', '==', 'material'),
          where('moduleId', 'in', ['high-cycle']),
        ),
      ),
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:rules` (needs `TEMP`/`TMP=C:/Temp` and Java 21 on this machine; see memory `reference_rules_test_emulator`).
Expected: the four new "reads/matches" assertions FAIL (access denied — rule not yet aware of autoEnable); the "non-matching denied" test passes incidentally.

- [ ] **Step 3: Add rules helpers**

In `firestore.rules`, inside the `match /databases/{database}/documents {` helper
block, add after `isCurrentUserEmail` (around line 52):

```
    // The requesting staff doc (lowercased-email key matches the token email).
    function staffDocData() {
      return get(/databases/$(database)/documents/staff/$(request.auth.token.email)).data;
    }

    // Does the requester satisfy the given module's autoEnable rule? Mirrors
    // staffMatchesAutoEnable in @ops/shared — keep the two in sync.
    function matchesModuleAutoEnable(moduleId) {
      let auto = get(/databases/$(database)/documents/modules/$(moduleId)).data.get('autoEnable', null);
      let y = staffDocData().get('year', 1);
      let summ = staffDocData().get('summativeYear', false);
      let status = y >= 4 ? 'probationary' : (summ ? 'high' : 'low');
      let dy = y >= 4 ? y - 3 : y;
      return auto != null
        && ((auto.dimension == 'status' && auto.value == status)
            || (auto.dimension == 'year' && auto.value == dy));
    }
```

- [ ] **Step 4: Extend the items read rule**

In `firestore.rules`, replace the `allow read` line of the
`match /{path=**}/items/{itemId}` block (lines ~120-124) with:

```
      allow read: if isAdmin()
        || (isFromOronoDomain()
            && (resource.data.moduleId in staffDocData().get('modules', [])
                || matchesModuleAutoEnable(resource.data.moduleId)));
```

(Leave `allow write: if isAdmin();` unchanged.)

- [ ] **Step 5: Run to verify all rules tests pass**

Run: `pnpm test:rules`
Expected: PASS — the new block is green and all pre-existing module/rules tests still pass.

- [ ] **Step 6: Commit**

```bash
git add firestore.rules tests/rules/modules.test.ts
git commit -m "feat(rules): grant module-item access when staff matches autoEnable"
```

---

## Task 5: Auto-enable control in the module dialog

**Files:**
- Modify: `apps/web/src/admin/modules/ModulesPage.tsx`

- [ ] **Step 1: Update imports + form state**

In `apps/web/src/admin/modules/ModulesPage.tsx`, extend the shared import (line 5):

```ts
import {
  COLLECTIONS,
  MODULE_COLORS,
  type AutoEnable,
  type ModuleColor,
  type ModuleDoc,
} from '@ops/shared';
```

Add this import below it:

```ts
import { CYCLE_STATUSES, cycleStatusLabel } from '@/admin/staff/staffCycle';
```

Add `autoEnable` to `ModuleFormState`:

```ts
interface ModuleFormState {
  displayName: string;
  moduleId: string;
  description: string;
  color: ModuleColor;
  isActive: boolean;
  autoEnable: AutoEnable | null;
}
```

Add it to `emptyForm`:

```ts
const emptyForm: ModuleFormState = {
  displayName: '',
  moduleId: '',
  description: '',
  color: 'blue',
  isActive: true,
  autoEnable: null,
};
```

- [ ] **Step 2: Carry autoEnable through initial state + reset**

In `ModuleDialog`, update the `initial` object and the open-reset `setForm` call
to include `autoEnable`. The `initial` ternary's truthy branch becomes:

```ts
    ? {
        displayName: existing.displayName,
        moduleId: existing.moduleId,
        description: existing.description,
        color: existing.color,
        isActive: existing.isActive,
        autoEnable: existing.autoEnable ?? null,
      }
```

And the reset block inside `if (open && form.moduleId !== (existing?.moduleId ?? '') && existing)`:

```ts
    setForm({
      displayName: existing.displayName,
      moduleId: existing.moduleId,
      description: existing.description,
      color: existing.color,
      isActive: existing.isActive,
      autoEnable: existing.autoEnable ?? null,
    });
```

- [ ] **Step 3: Persist autoEnable on save**

In `save()`, add `autoEnable` to the `setDoc` payload (after `isActive:`):

```ts
          isActive: form.isActive,
          autoEnable: form.autoEnable,
```

- [ ] **Step 4: Add the auto-enable UI**

In the dialog body, insert this block immediately after the "Active" checkbox
`<div className="flex items-center gap-2">…</div>` and before the `{error ? …}`
block:

```tsx
          <div className="grid gap-2">
            <Label>Auto-enable</Label>
            <p className="text-muted-foreground text-xs">
              Staff matching this rule get the module automatically. You can still add others by
              hand from the Staff table.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={form.autoEnable?.dimension ?? 'off'}
                onChange={(e) => {
                  const mode = e.target.value;
                  setForm((f) => ({
                    ...f,
                    autoEnable:
                      mode === 'status'
                        ? { dimension: 'status', value: 'high' }
                        : mode === 'year'
                          ? { dimension: 'year', value: 1 }
                          : null,
                  }));
                }}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                <option value="off">Off (manual only)</option>
                <option value="status">By status</option>
                <option value="year">By year</option>
              </select>

              {form.autoEnable?.dimension === 'status' ? (
                <select
                  value={form.autoEnable.value}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      autoEnable: {
                        dimension: 'status',
                        value: e.target.value as (typeof CYCLE_STATUSES)[number],
                      },
                    }))
                  }
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  {CYCLE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {cycleStatusLabel(s)}
                    </option>
                  ))}
                </select>
              ) : null}

              {form.autoEnable?.dimension === 'year' ? (
                <select
                  value={form.autoEnable.value}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      autoEnable: { dimension: 'year', value: Number(e.target.value) as 1 | 2 | 3 },
                    }))
                  }
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  {[1, 2, 3].map((y) => (
                    <option key={y} value={y}>
                      Year {y}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ops/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/admin/modules/ModulesPage.tsx
git commit -m "feat(modules): auto-enable control (by status or year) in module dialog"
```

---

## Task 6: Locked option support in PillMultiSelect

**Files:**
- Modify: `apps/web/src/admin/_shared/PillEditor.tsx`

- [ ] **Step 1: Add `locked` to PillOption**

In `apps/web/src/admin/_shared/PillEditor.tsx`, extend `PillOption`:

```ts
export interface PillOption {
  value: string;
  label: string;
  color?: PillColor;
  /** Forced-on by a rule (e.g. module auto-enable): rendered checked + disabled
   *  with an "Auto" tag; toggling is suppressed by the caller. */
  locked?: boolean;
}
```

- [ ] **Step 2: Render the locked state in ToggleRow**

Replace the `ToggleRow` function body's returned JSX with:

```tsx
  return (
    <div className="hover:bg-accent flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
        <PillChip color={option.color}>{option.label}</PillChip>
        {option.locked ? (
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
            Auto
          </span>
        ) : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onToggle} disabled={option.locked} />
    </div>
  );
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ops/web typecheck`
Expected: no errors (the new field is optional; existing callers unaffected).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/admin/_shared/PillEditor.tsx
git commit -m "feat(admin): PillMultiSelect supports locked (auto) options"
```

---

## Task 7: Auto-match + lock in the Module Access pill

**Files:**
- Modify: `apps/web/src/admin/staff/StaffInlineEditors.tsx`

- [ ] **Step 1: Import the helper**

In `apps/web/src/admin/staff/StaffInlineEditors.tsx`, extend the shared import (line 1):

```ts
import {
  type Building,
  type ModuleDoc,
  type PillColorName,
  type Role,
  type Staff,
  staffMatchesAutoEnable,
} from '@ops/shared';
```

- [ ] **Step 2: Compute matches, mark options locked, and lock toggles**

Replace the body of `ModuleAccessPill` (from `const selected = …` through the
`return` JSX) with:

```ts
  const selected = new Set<string>(assignedModules);
  if (row.hasAdminAccess) selected.add(ADMIN_ACCESS);
  for (const m of modules) {
    if (staffMatchesAutoEnable(row, m.autoEnable ?? null)) selected.add(m.moduleId);
  }

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
```

(The `const selected`/`options`/`toggle` declarations that previously existed are
fully replaced by the block above; keep the `assignedModules` line just before it.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ops/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/admin/staff/StaffInlineEditors.tsx
git commit -m "feat(staff): show auto-enabled modules as locked in Module Access pill"
```

---

## Task 8: Effective membership in the sidebar module nav

**Files:**
- Modify: `apps/web/src/components/AppSidebar.tsx`

- [ ] **Step 1: Import the helper**

In `apps/web/src/components/AppSidebar.tsx`, add `staffMatchesAutoEnable` to the
`@ops/shared` import block (lines 19-26):

```ts
import {
  COLLECTIONS,
  SPECIAL_ROLES,
  staffMatchesAutoEnable,
  type ModuleDoc,
  type Role,
  type Rubric,
  type Staff,
} from '@ops/shared';
```

- [ ] **Step 2: Union manual + auto in moduleNavItems**

In the `moduleNavItems` IIFE (around line 270), replace:

```ts
    const assigned = new Set(myStaff.modules ?? []);
```

with:

```ts
    const assigned = new Set(myStaff.modules ?? []);
    for (const m of allModules) {
      if (staffMatchesAutoEnable(myStaff, m.autoEnable ?? null)) assigned.add(m.moduleId);
    }
```

(The `eslint-disable` comment above the original line stays; the `.filter(...hasPage && isActive && assigned.has...)` chain is unchanged.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ops/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AppSidebar.tsx
git commit -m "feat(nav): include auto-enabled modules in the sidebar nav"
```

---

## Task 9: Effective membership in the staff dashboard

**Files:**
- Modify: `apps/web/src/dashboard/StaffDashboardPage.tsx`

- [ ] **Step 1: Import the helper**

In `apps/web/src/dashboard/StaffDashboardPage.tsx`, add `staffMatchesAutoEnable`
to the `@ops/shared` import (keep the other named imports already present):

```ts
import { staffMatchesAutoEnable } from '@ops/shared';
```

(If `@ops/shared` is already imported with braces in this file, add the name to
that existing import instead of adding a second statement.)

- [ ] **Step 2: Union into assignedModuleIds (the materials query source)**

Replace the `assignedModuleIds` memo (around line 100):

```ts
  const assignedModuleIds = useMemo(() => (staff?.modules ?? []).slice(0, 30), [staff]);
```

with:

```ts
  const assignedModuleIds = useMemo(() => {
    if (!staff) return [];
    const ids = new Set(staff.modules ?? []);
    for (const m of modulesData ?? []) {
      if (staffMatchesAutoEnable(staff, m.autoEnable ?? null)) ids.add(m.moduleId);
    }
    return [...ids].slice(0, 30);
  }, [staff, modulesData]);
```

- [ ] **Step 3: Union into moduleChips**

Replace the `moduleChips` memo (around line 237):

```ts
  const moduleChips = useMemo<ModuleChip[]>(() => {
    if (!staff || !modulesData) return [];
    return modulesData
      .filter(
        (m) =>
          (staff.modules ?? []).includes(m.moduleId) ||
          staffMatchesAutoEnable(staff, m.autoEnable ?? null),
      )
      .map((m) => ({ moduleId: m.moduleId, displayName: m.displayName, color: m.color }));
  }, [staff, modulesData]);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ops/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/StaffDashboardPage.tsx
git commit -m "feat(dashboard): include auto-enabled modules in chips + materials"
```

---

## Task 10: Effective membership in the module page guard

**Files:**
- Modify: `apps/web/src/modules/ModulePage.tsx`

- [ ] **Step 1: Import the helper**

In `apps/web/src/modules/ModulePage.tsx`, add to the `@ops/shared` import:

```ts
import { staffMatchesAutoEnable } from '@ops/shared';
```

(Add the name to the existing braced `@ops/shared` import if present.)

- [ ] **Step 2: Extend the isAssigned guard**

Replace the `isAssigned` memo (lines ~44-47):

```ts
  const isAssigned = useMemo(() => {
    if (claims.isAdmin) return true;
    return (myStaff?.modules ?? []).includes(moduleId);
  }, [claims.isAdmin, myStaff, moduleId]);
```

with:

```ts
  const isAssigned = useMemo(() => {
    if (claims.isAdmin) return true;
    if (!myStaff) return false;
    return (
      (myStaff.modules ?? []).includes(moduleId) ||
      staffMatchesAutoEnable(myStaff, module?.autoEnable ?? null)
    );
  }, [claims.isAdmin, myStaff, moduleId, module]);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ops/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modules/ModulePage.tsx
git commit -m "feat(modules): auto-enabled staff pass the module page guard"
```

---

## Task 11: Surface Delete in the Modules row menu

**Files:**
- Modify: `apps/web/src/admin/modules/ModulesPage.tsx`

- [ ] **Step 1: Add row-delete state + handler**

In `ModulesPage` (the list component), add state next to the existing
`useState` calls:

```ts
  const [deleting, setDeleting] = useState<ModuleRow | null>(null);
```

Add a delete handler inside `ModulesPage` (above the `return`):

```ts
  async function confirmDelete() {
    if (!deleting) return;
    await deleteDoc(doc(db, COLLECTIONS.modules, deleting.moduleId));
    setDeleting(null);
  }
```

`deleteDoc`, `doc`, `db`, and `COLLECTIONS` are already imported in this file.

- [ ] **Step 2: Add the Delete menu item**

In the `rowActions` `DropdownMenuContent`, add below the existing "Edit" item:

```tsx
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => setDeleting(r)}
              >
                Delete
              </DropdownMenuItem>
```

- [ ] **Step 3: Add the confirmation dialog**

Add this dialog right after the two existing `<ModuleDialog … />` elements
(before the closing `</PageHeader>`):

```tsx
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete module</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>{deleting?.displayName}</strong>? Staff currently assigned
              keep the ID, but the module doc will be gone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} type="button">
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} type="button">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

The `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`,
`DialogFooter`, and `Button` components are already imported in this file.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @ops/web typecheck`
Expected: no errors.
Run: `npx eslint apps/web/src/admin/modules/ModulesPage.tsx --max-warnings 0`
Expected: no errors (CRLF prettier warnings are pre-existing local noise; ignore).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/admin/modules/ModulesPage.tsx
git commit -m "feat(modules): add Delete to the module row menu"
```

---

## Task 12: Full verification + manual QA

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + targeted lint + shared/rules tests**

Run: `pnpm -r typecheck`
Expected: all packages pass.

Run: `pnpm --filter @ops/shared test`
Expected: cycle + module suites pass.

Run: `pnpm test:rules`
Expected: all rules suites pass (TEMP/TMP + Java 21 per memory).

Run lint on every changed web file:
`npx eslint apps/web/src/admin/modules/ModulesPage.tsx apps/web/src/admin/_shared/PillEditor.tsx apps/web/src/admin/staff/StaffInlineEditors.tsx apps/web/src/admin/staff/staffCycle.ts apps/web/src/components/AppSidebar.tsx apps/web/src/dashboard/StaffDashboardPage.tsx apps/web/src/modules/ModulePage.tsx --max-warnings 0`
Expected: 0 errors.

- [ ] **Step 2: Manual QA in the preview**

Using the dev preview:
1. Modules → create/edit a module → set Auto-enable = By status → High Cycle. Save.
2. Staff table → Module Access for a High-Cycle staff member shows that module on + "Auto" + the toggle disabled. A Low-Cycle staff member shows it off and toggleable.
3. Change that staff member's Status pill to Low Cycle → the module's chip drops off their Module Access.
4. Sign in as / impersonate a matching staff member (or check the dashboard data): the module chip appears on the dashboard and, if `hasPage`, the module page opens (no "not assigned" empty state).
5. Modules row menu → Delete → confirm removes the module.

- [ ] **Step 3: Final commit if any QA fixes were needed**

```bash
git add -A
git commit -m "fix(modules): auto-enable QA follow-ups"
```

---

## Self-Review Notes

- **Spec coverage:** schema field (T2) · cycle move (T1, T3) · helper (T2) · module dialog control (T5) · pill lock (T6, T7) · sidebar (T8) · dashboard chips + materials (T9) · module page guard (T10) · rules + tests (T4) · delete discoverability (T11). All spec sections mapped.
- **Type consistency:** `autoEnable` (schema export), `AutoEnable` (type), `staffMatchesAutoEnable(staff, rule)` used identically across T5/T7/T8/T9/T10. Rules math mirrors the helper and is guarded by T4 tests.
- **YAGNI:** no multi-value criteria, no per-person exclusions, no Cloud Function.
