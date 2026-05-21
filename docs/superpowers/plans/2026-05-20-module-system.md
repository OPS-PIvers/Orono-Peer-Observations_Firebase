# Module System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn modules from display-only chips into a capability system — each module can carry a staff-facing page (rich-text / resources / trackable materials), appear in the sidebar for assigned staff, gate its content by assignment, and surface its materials in the dashboard task timeline; admins author it all with no code.

**Architecture:** Extend the `@ops/shared` `moduleDoc` (`hasPage`, `icon`, `sections`) and add `moduleItem` (subcollection `/modules/{id}/items`) + `moduleProgress` (subcollection `/staff/{email}/moduleProgress`) schemas. Items carry `moduleId` so a single `collectionGroup('items')` query can power the dashboard and a recursive rule can gate reads by the viewer's assigned modules. The sidebar reads assigned modules dynamically; a new `/m/:moduleId` route renders a generic section-driven page; the admin builder lives at `/admin/modules/:moduleId`; module materials become extra `CheckpointWithStatus` entries merged into the existing dashboard timeline.

**Tech Stack:** pnpm monorepo (`@ops/shared` Zod schemas built to `dist`; `@ops/web` React 19 + Vite + Tailwind v4 + react-router v7; Firebase Firestore + Storage). Tests: Vitest (unit) + `@firebase/rules-unit-testing` (rules, run via `pnpm test:rules`).

---

## Critical conventions (read before starting)

- **`@ops/shared` is consumed as a built package.** After ANY edit under `packages/shared/src`, run `pnpm --filter @ops/shared build` or web/functions will see stale types. Wave 0 ends with a build; later waves assume `dist` is current.
- **Zod v4 syntax** is in use: `z.email()`, `z.url()`, `z.enum([...])`, `z.record(k, v)`. Follow `packages/shared/src/schema/common.ts`.
- **Schema export barrel:** every new schema file must be re-exported from `packages/shared/src/schema/index.ts`.
- **Collection paths** come from `COLLECTIONS` in `packages/shared/src/constants.ts` — never hardcode strings.
- **Firestore reads bypass Zod defaults.** Older docs may lack new fields; guard array/optional reads with `?? []` / `?? ''` and an `// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` comment where the type says non-optional (this is the established pattern in `StaffInlineEditors.tsx`).
- **Admin pages** use `PageHeader variant="light"` + breadcrumb, `AdminDataView`, the standardized `Dialog` (sticky `DialogFooter`), `Button` hierarchy, `Card`/`Badge`/`EmptyState`. **Staff-facing pages** use `PageHeader variant="plain"` (see `apps/web/src/routes/MyRubricPage.tsx`). Do not put admin chrome on the staff module page.
- **Verification commands** (run from repo root): `pnpm --filter @ops/shared test`, `pnpm test:rules`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`. Format before committing markdown/code to avoid CI `format:check` failures.

## File structure

**Created:**

- `packages/shared/src/schema/moduleItem.ts` — `moduleItem` schema + `moduleProgress` schema + kind/type enums.
- `packages/shared/src/schema/module.test.ts` — unit tests for module/section/item/progress schemas.
- `apps/web/src/modules/moduleIcons.ts` — `MODULE_ICONS` slug → lucide component map.
- `apps/web/src/modules/ModulePage.tsx` — staff-facing `/m/:moduleId` page (loads doc + items + own progress, guards access, renders sections).
- `apps/web/src/modules/moduleSections.tsx` — `RichTextSection`, `ResourceListSection`, `MaterialsSection` render components.
- `apps/web/src/admin/modules/ModuleBuilderPage.tsx` — admin builder at `/admin/modules/:moduleId`.
- `apps/web/src/admin/modules/ModuleSectionEditor.tsx` — one section editor (title, type-specific content, reorder/delete).
- `apps/web/src/dashboard/deriveModuleTasks.ts` — pure fn: material items + progress → `CheckpointWithStatus[]`.
- `apps/web/src/dashboard/deriveModuleTasks.test.ts` — unit tests for the derivation.
- `tests/rules/modules.test.ts` — rules tests for items + moduleProgress.

**Modified:**

- `packages/shared/src/schema/module.ts` — add `hasPage`, `icon`, `sections` + `moduleSection` + `MODULE_ICONS`.
- `packages/shared/src/constants.ts` — add `MODULE_SUBCOLLECTIONS`, `STAFF_SUBCOLLECTIONS`.
- `packages/shared/src/schema/index.ts` — export `moduleItem.js`.
- `firestore.rules` — recursive `items` read rule + `moduleProgress` rule.
- `firestore.indexes.json` — collection-group index for `items` (kind, moduleId).
- `apps/web/src/lazyRoutes.ts` — register `ModulePage` + `ModuleBuilderPage` + prefetch entries.
- `apps/web/src/App.tsx` — add `/m/:moduleId` and `admin/modules/:moduleId` routes.
- `apps/web/src/components/AppSidebar.tsx` — dynamic assigned-module nav entries.
- `apps/web/src/admin/modules/ModulesPage.tsx` — row click → builder route; show `hasPage` badge.
- `apps/web/src/dashboard/deriveCheckpoints.ts` — widen `CheckpointWithStatus.key`; add `moduleItemId`.
- `apps/web/src/dashboard/DashboardView.tsx` — render Mark-done for module tasks via `onCompleteModuleItem`.
- `apps/web/src/dashboard/StaffDashboardPage.tsx` — load assigned-module materials + progress, merge tasks, wire Mark-done.

---

# WAVE 0 — Shared schema foundation (serial; everything depends on it)

### Task 1: Extend the module schema (`moduleDoc` + sections + icons)

**Files:**

- Modify: `packages/shared/src/schema/module.ts`

- [ ] **Step 1: Add icon list, section-type enum, and `moduleSection` schema**

In `packages/shared/src/schema/module.ts`, after the existing `moduleColor` block (after line 28) and before `export const moduleDoc`, insert:

```ts
/** Curated lucide icon slugs an admin can pick for a module's sidebar entry.
 *  Keep in sync with apps/web/src/modules/moduleIcons.ts. */
export const MODULE_ICONS = [
  'shapes',
  'book-open',
  'graduation-cap',
  'users',
  'clipboard-list',
  'folder',
  'star',
  'compass',
  'lightbulb',
  'target',
  'library',
  'presentation',
] as const;
export type ModuleIcon = (typeof MODULE_ICONS)[number];
export const moduleIcon = z.enum(MODULE_ICONS);

/** The three section types an admin can compose a module page from. */
export const MODULE_SECTION_TYPES = ['richtext', 'resources', 'materials'] as const;
export type ModuleSectionType = (typeof MODULE_SECTION_TYPES)[number];
export const moduleSectionType = z.enum(MODULE_SECTION_TYPES);

/**
 * One ordered section on a module page. `body` carries rich-text HTML and is
 * only meaningful when `type === 'richtext'`; resources/materials sections pull
 * their content from the `/modules/{id}/items` subcollection by `sectionId`.
 */
export const moduleSection = z.object({
  id: z.string().min(1).max(64),
  type: moduleSectionType,
  title: z.string().trim().max(120).default(''),
  body: z.string().default(''),
});
export type ModuleSection = z.infer<typeof moduleSection>;
```

- [ ] **Step 2: Add the new fields to `moduleDoc`**

In the same file, change the `moduleDoc` object (currently lines 30-39) to add three fields after `isActive`:

```ts
export const moduleDoc = z.object({
  moduleId: slugId,
  displayName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).default(''),
  color: moduleColor.default('blue'),
  isActive: z.boolean().default(true),
  /** When true the module has a staff-facing page + sidebar entry for
   *  assigned staff. When false it stays a display-only chip. */
  hasPage: z.boolean().default(false),
  /** Lucide icon slug for the sidebar entry. */
  icon: moduleIcon.default('shapes'),
  /** Ordered page layout. Content for resources/materials sections lives in
   *  the items subcollection; rich-text content lives inline on the section. */
  sections: z.array(moduleSection).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
```

(The `moduleInput` derivation below it is unchanged — it still omits the audit timestamps.)

- [ ] **Step 3: Commit (committed together with Task 2's tests in Task 2 Step 4)**

Skip an isolated commit here; Tasks 1–3 are committed as one foundation commit in Task 3 after the build passes. Proceed to Task 2.

---

### Task 2: Add `moduleItem` + `moduleProgress` schemas with tests

**Files:**

- Create: `packages/shared/src/schema/moduleItem.ts`
- Create: `packages/shared/src/schema/module.test.ts`
- Modify: `packages/shared/src/schema/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/schema/module.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { moduleDoc, moduleSection } from './module.js';
import { moduleItem, moduleProgress } from './moduleItem.js';

const now = new Date('2026-05-20T00:00:00Z');

describe('moduleDoc new fields', () => {
  it('defaults hasPage=false, icon=shapes, sections=[]', () => {
    const parsed = moduleDoc.parse({
      moduleId: 'mentor',
      displayName: 'Mentor',
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.hasPage).toBe(false);
    expect(parsed.icon).toBe('shapes');
    expect(parsed.sections).toEqual([]);
  });

  it('rejects an unknown icon slug', () => {
    expect(() =>
      moduleDoc.parse({
        moduleId: 'mentor',
        displayName: 'Mentor',
        icon: 'not-a-real-icon',
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });
});

describe('moduleSection', () => {
  it('accepts the three section types and defaults body to empty', () => {
    const s = moduleSection.parse({ id: 's1', type: 'richtext' });
    expect(s.body).toBe('');
    expect(moduleSection.parse({ id: 's2', type: 'resources' }).type).toBe('resources');
    expect(moduleSection.parse({ id: 's3', type: 'materials' }).type).toBe('materials');
  });
});

describe('moduleItem', () => {
  it('parses a resource with a link', () => {
    const item = moduleItem.parse({
      itemId: 'i1',
      moduleId: 'mentor',
      kind: 'resource',
      sectionId: 's2',
      title: 'Handbook',
      linkUrl: 'https://example.com/handbook',
      createdAt: now,
      updatedAt: now,
    });
    expect(item.kind).toBe('resource');
    expect(item.order).toBe(0);
  });

  it('parses a material with a due date', () => {
    const item = moduleItem.parse({
      itemId: 'i2',
      moduleId: 'mentor',
      kind: 'material',
      sectionId: 's3',
      title: 'Watch onboarding video',
      dueDate: '2026-06-01',
      createdAt: now,
      updatedAt: now,
    });
    expect(item.kind).toBe('material');
    expect(item.description).toBe('');
  });
});

describe('moduleProgress', () => {
  it('parses a done record', () => {
    const p = moduleProgress.parse({
      itemId: 'i2',
      moduleId: 'mentor',
      status: 'done',
      completedAt: now,
    });
    expect(p.status).toBe('done');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @ops/shared test`
Expected: FAIL — `Cannot find module './moduleItem.js'` (file not created yet).

- [ ] **Step 3: Create `moduleItem.ts` and export it**

Create `packages/shared/src/schema/moduleItem.ts`:

```ts
import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';

/**
 * /modules/{moduleId}/items/{itemId} — the resource and material content for a
 * module page. `moduleId` is denormalized onto each item so a single
 * collectionGroup('items') query can power the dashboard and so the recursive
 * security rule can gate reads by the viewer's assigned modules.
 */
export const MODULE_ITEM_KINDS = ['resource', 'material'] as const;
export type ModuleItemKind = (typeof MODULE_ITEM_KINDS)[number];
export const moduleItemKind = z.enum(MODULE_ITEM_KINDS);

export const moduleItem = z.object({
  itemId: z.string().min(1).max(64),
  moduleId: slugId,
  kind: moduleItemKind,
  /** Which moduleSection.id this item renders under. */
  sectionId: z.string().min(1).max(64),
  order: z.number().int().nonnegative().default(0),
  title: z.string().trim().min(1).max(200),
  // resource-only:
  fileUrl: z.url().optional(),
  linkUrl: z.url().optional(),
  // material-only:
  description: z.string().trim().max(2000).default(''),
  /** ISO calendar date (yyyy-mm-dd); optional. */
  dueDate: z.string().trim().optional(),
  /** Optional deep link for the material's CTA. */
  ctaUrl: z.string().trim().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type ModuleItem = z.infer<typeof moduleItem>;

export const moduleItemInput = moduleItem.omit({ createdAt: true, updatedAt: true });
export type ModuleItemInput = z.infer<typeof moduleItemInput>;

/**
 * /staff/{email}/moduleProgress/{itemId} — per-staff completion of a material
 * item. Stored under the staff member's own doc so rules are trivial. Absence
 * of a doc means "not done".
 */
export const moduleProgress = z.object({
  itemId: z.string().min(1).max(64),
  moduleId: slugId,
  status: z.literal('done'),
  completedAt: isoDate,
});
export type ModuleProgress = z.infer<typeof moduleProgress>;
```

Then add to `packages/shared/src/schema/index.ts` after the `export * from './module.js';` line:

```ts
export * from './moduleItem.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ops/shared test`
Expected: PASS (the new `module.test.ts` plus the existing `roles.test.ts`).

---

### Task 3: Add subcollection constants and build the shared package

**Files:**

- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add subcollection name constants**

In `packages/shared/src/constants.ts`, after the `WINDOW_SUBCOLLECTIONS` block (after line 40) add:

```ts
/** Subcollections under /modules/{moduleId}. */
export const MODULE_SUBCOLLECTIONS = {
  items: 'items',
} as const;

/** Subcollections under /staff/{email}. */
export const STAFF_SUBCOLLECTIONS = {
  moduleProgress: 'moduleProgress',
} as const;
```

- [ ] **Step 2: Build the shared package**

Run: `pnpm --filter @ops/shared build`
Expected: tsc emits to `packages/shared/dist` with no errors.

- [ ] **Step 3: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: PASS (no consumer broke; all additions are additive with defaults).

- [ ] **Step 4: Commit the foundation**

```bash
git add packages/shared/src/schema/module.ts packages/shared/src/schema/moduleItem.ts packages/shared/src/schema/module.test.ts packages/shared/src/schema/index.ts packages/shared/src/constants.ts packages/shared/dist
git commit -m "feat(shared): module page schema — hasPage/icon/sections, items, progress"
```

---

# WAVE 1 — Parallel build (disjoint files; dispatch [a]–[d] concurrently)

> Each Wave 1 task touches a different file set and can be implemented by a separate subagent in parallel. All assume Wave 0 is committed and `dist` is built.

### Task 4 [Wave 1a]: Security rules + index for items & moduleProgress

**Files:**

- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Create: `tests/rules/modules.test.ts`

- [ ] **Step 1: Write the failing rules tests**

Create `tests/rules/modules.test.ts`:

```ts
import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

describe('/modules/{id}/items — read gated by assignment, write admin-only', () => {
  beforeEach(async () => {
    await seed('staff/assigned@orono.k12.mn.us', { modules: ['mentor'] });
    await seed('staff/other@orono.k12.mn.us', { modules: ['ilt'] });
    await seed('modules/mentor/items/i1', {
      itemId: 'i1',
      moduleId: 'mentor',
      kind: 'resource',
      sectionId: 's1',
      title: 'Handbook',
    });
  });

  it('assigned staff can read an item', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/mentor/items/i1')));
  });

  it('unassigned staff cannot read an item', async () => {
    const db = testEnv
      .authenticatedContext('o', claims.teacher('other@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'modules/mentor/items/i1')));
  });

  it('admin can read and write items', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/mentor/items/i1')));
    await assertSucceeds(
      setDoc(doc(db, 'modules/mentor/items/i2'), {
        itemId: 'i2',
        moduleId: 'mentor',
        kind: 'material',
        sectionId: 's2',
        title: 'Task',
      }),
    );
  });

  it('assigned staff cannot write items', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      setDoc(doc(db, 'modules/mentor/items/i3'), {
        itemId: 'i3',
        moduleId: 'mentor',
        kind: 'resource',
        sectionId: 's1',
        title: 'X',
      }),
    );
  });
});

describe('/staff/{email}/moduleProgress — own progress only', () => {
  beforeEach(async () => {
    await seed('staff/me@orono.k12.mn.us', { modules: ['mentor'] });
  });

  it('a staff member can write their own progress', async () => {
    const db = testEnv.authenticatedContext('me', claims.teacher('me@orono.k12.mn.us')).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'staff/me@orono.k12.mn.us/moduleProgress/i1'), {
        itemId: 'i1',
        moduleId: 'mentor',
        status: 'done',
      }),
    );
  });

  it("a staff member cannot write someone else's progress", async () => {
    const db = testEnv.authenticatedContext('me', claims.teacher('me@orono.k12.mn.us')).firestore();
    await assertFails(
      setDoc(doc(db, 'staff/other@orono.k12.mn.us/moduleProgress/i1'), {
        itemId: 'i1',
        moduleId: 'mentor',
        status: 'done',
      }),
    );
  });

  it('admin can read a staff member progress doc', async () => {
    await seed('staff/me@orono.k12.mn.us/moduleProgress/i1', {
      itemId: 'i1',
      moduleId: 'mentor',
      status: 'done',
    });
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'staff/me@orono.k12.mn.us/moduleProgress/i1')));
  });
});
```

- [ ] **Step 2: Run the rules tests to verify they fail**

Run: `pnpm test:rules`
Expected: FAIL — the new `modules.test.ts` cases fail (default-deny blocks the item reads/writes; no rule yet).

- [ ] **Step 3: Add the rules**

In `firestore.rules`, replace the existing `/modules/{moduleId}` block (lines 92-98) with:

```
    // --- /modules/{moduleId} -------------------------------------------------
    // Admin-defined participation tracks. Read: anyone signed-in from the
    // domain (clients render module chips + nav). Write: admin only.
    match /modules/{moduleId} {
      allow read: if isFromOronoDomain();
      allow write: if isAdmin();
    }

    // --- module items (collection-group rule) --------------------------------
    // Resource/material content under /modules/{id}/items. Read: admin, OR a
    // signed-in staff member whose /staff doc lists this item's moduleId in
    // its `modules` array. Recursive ({path=**}) so the same rule authorizes
    // both direct gets and the dashboard's collectionGroup('items') query.
    // Write: admin only.
    match /{path=**}/items/{itemId} {
      allow read: if isAdmin()
        || (isFromOronoDomain()
            && resource.data.moduleId in
               get(/databases/$(database)/documents/staff/$(request.auth.token.email))
                 .data.get('modules', []));
      allow write: if isAdmin();
    }
```

Then inside the existing `match /staff/{email}` block (after the `allow create, update, delete: if isAdmin();` line, before the closing brace at line 77) add the nested progress match:

```
      // Per-staff module completion. Only the owner (or admin) reads/writes.
      match /moduleProgress/{itemId} {
        allow read, write: if isCurrentUserEmail(email) || isAdmin();
      }
```

- [ ] **Step 4: Add the collection-group index**

In `firestore.indexes.json`, add an entry to the `indexes` array (the dashboard query is `collectionGroup('items')` with `where('kind','==') + where('moduleId','in')`):

```json
{
  "collectionGroup": "items",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "kind", "order": "ASCENDING" },
    { "fieldPath": "moduleId", "order": "ASCENDING" }
  ]
}
```

- [ ] **Step 5: Run rules tests to verify they pass**

Run: `pnpm test:rules`
Expected: PASS (all `modules.test.ts` cases + the existing rules suites still green).

- [ ] **Step 6: Validate and commit**

```bash
npx firebase firestore:rules:validate || true   # syntax sanity if available; skip if not
git add firestore.rules firestore.indexes.json tests/rules/modules.test.ts
git commit -m "feat(rules): gate module items by assignment + per-staff moduleProgress"
```

> Deployment of rules + index happens in Wave 3 (`firebase deploy --only firestore:rules,firestore:indexes`) so the dev project picks them up.

---

### Task 5 [Wave 1b]: Dynamic assigned-module sidebar entries

**Files:**

- Create: `apps/web/src/modules/moduleIcons.ts`
- Modify: `apps/web/src/components/AppSidebar.tsx`

- [ ] **Step 1: Create the icon map**

Create `apps/web/src/modules/moduleIcons.ts`:

```ts
import {
  BookOpen,
  ClipboardList,
  Compass,
  Folder,
  GraduationCap,
  Library,
  Lightbulb,
  Presentation,
  Shapes,
  Star,
  Target,
  Users,
} from 'lucide-react';
import type { ModuleIcon } from '@ops/shared';

/** Module icon slug → lucide component. Keep keys in sync with MODULE_ICONS
 *  in packages/shared/src/schema/module.ts. */
export const MODULE_ICON_COMPONENTS: Record<ModuleIcon, React.ElementType> = {
  shapes: Shapes,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  users: Users,
  'clipboard-list': ClipboardList,
  folder: Folder,
  star: Star,
  compass: Compass,
  lightbulb: Lightbulb,
  target: Target,
  library: Library,
  presentation: Presentation,
};

export function moduleIconComponent(icon: string): React.ElementType {
  return MODULE_ICON_COMPONENTS[icon as ModuleIcon] ?? Shapes;
}
```

- [ ] **Step 2: Load assigned modules and render their nav entries**

In `apps/web/src/components/AppSidebar.tsx`:

1. Add imports near the existing `@ops/shared` import (line 19) and the lazyRoutes import:

```ts
import {
  COLLECTIONS,
  SPECIAL_ROLES,
  type ModuleDoc,
  type Role,
  type Rubric,
  type Staff,
} from '@ops/shared';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { moduleIconComponent } from '@/modules/moduleIcons';
```

(Merge `ModuleDoc` and `Staff` into the existing destructured `@ops/shared` import rather than duplicating it.)

2. Inside `AppSidebar`, after the existing `rubrics` collection load (around line 252), load the current user's staff doc and all modules:

```ts
const emailLower = user?.email?.toLowerCase() ?? '';
const { data: myStaff } = useFirestoreDoc<Staff>(
  emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '',
);
const { data: allModules } = useFirestoreCollection<ModuleDoc>(COLLECTIONS.modules);

// Modules this user is assigned that have a staff-facing page → sidebar items.
const moduleNavItems: NavItem[] = (() => {
  if (!myStaff || !allModules) return [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older staff docs may lack `modules`
  const assigned = new Set(myStaff.modules ?? []);
  return allModules
    .filter((m) => m.hasPage && m.isActive && assigned.has(m.moduleId))
    .slice()
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((m) => ({
      icon: moduleIconComponent(m.icon),
      label: m.displayName,
      href: `/m/${m.moduleId}`,
    }));
})();
```

3. Append `moduleNavItems` to the main nav. After `const navConfig = buildNavItems(...)` (around line 281-290), insert:

```ts
if (moduleNavItems.length > 0) {
  navConfig.main = [...navConfig.main, ...moduleNavItems];
}
```

- [ ] **Step 3: Verify in the browser**

Start the dev server (`preview_start` if not running). As an admin, you won't see module items until a module has `hasPage` + you're assigned it — so this is fully verified in Wave 3 after the builder exists. For now confirm: `pnpm typecheck` passes and the sidebar still renders the existing items with no console errors (`preview_console_logs`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/modules/moduleIcons.ts apps/web/src/components/AppSidebar.tsx
git commit -m "feat(nav): show assigned module pages in the sidebar"
```

---

### Task 6 [Wave 1c]: Staff-facing module page, route, and access guard

**Files:**

- Create: `apps/web/src/modules/moduleSections.tsx`
- Create: `apps/web/src/modules/ModulePage.tsx`
- Modify: `apps/web/src/lazyRoutes.ts`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create the section render components**

Create `apps/web/src/modules/moduleSections.tsx`:

```tsx
import { ExternalLink, FileText } from 'lucide-react';
import type { ModuleItem, ModuleSection } from '@ops/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

function sectionItems(items: ModuleItem[], sectionId: string, kind: ModuleItem['kind']) {
  return items
    .filter((i) => i.sectionId === sectionId && i.kind === kind)
    .slice()
    .sort((a, b) => a.order - b.order);
}

export function RichTextSection({ section }: { section: ModuleSection }) {
  const body = section.body.trim();
  return (
    <Card>
      {section.title ? (
        <CardHeader>
          <CardTitle>{section.title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent>
        {body ? (
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: body }} />
        ) : (
          <p className="text-muted-foreground text-sm">Nothing here yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function ResourceListSection({
  section,
  items,
}: {
  section: ModuleSection;
  items: ModuleItem[];
}) {
  const resources = sectionItems(items, section.id, 'resource');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.title || 'Resources'}</CardTitle>
      </CardHeader>
      <CardContent>
        {resources.length === 0 ? (
          <EmptyState icon={FileText} title="No resources yet" />
        ) : (
          <ul className="divide-border divide-y">
            {resources.map((r) => {
              const href = r.linkUrl ?? r.fileUrl ?? '';
              return (
                <li key={r.itemId} className="flex items-center gap-2 py-2">
                  <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                    >
                      {r.title}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-sm">{r.title}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function MaterialsSection({
  section,
  items,
  doneItemIds,
  onToggleDone,
}: {
  section: ModuleSection;
  items: ModuleItem[];
  doneItemIds: Set<string>;
  onToggleDone: (item: ModuleItem, done: boolean) => void;
}) {
  const materials = sectionItems(items, section.id, 'material');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{section.title || 'Materials'}</CardTitle>
      </CardHeader>
      <CardContent>
        {materials.length === 0 ? (
          <EmptyState icon={FileText} title="No materials yet" />
        ) : (
          <ul className="space-y-3">
            {materials.map((m) => {
              const done = doneItemIds.has(m.itemId);
              return (
                <li key={m.itemId} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{m.title}</span>
                      {done ? <Badge tone="active">Done</Badge> : null}
                      {!done && m.dueDate ? <Badge tone="warning">Due {m.dueDate}</Badge> : null}
                    </div>
                    {m.description ? (
                      <p className="text-muted-foreground mt-0.5 text-sm">{m.description}</p>
                    ) : null}
                  </div>
                  <Button
                    variant={done ? 'outline' : 'default'}
                    size="sm"
                    className="shrink-0"
                    onClick={() => onToggleDone(m, !done)}
                  >
                    {done ? 'Undo' : 'Mark done'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

> Note: confirm `Card`/`CardContent`/`CardHeader`/`CardTitle` and `EmptyState`'s prop names (`icon`, `title`) against `apps/web/src/components/ui/card.tsx` and `empty-state.tsx`; adjust the JSX to match the actual exported API if it differs.

- [ ] **Step 2: Create the module page with the access guard**

Create `apps/web/src/modules/ModulePage.tsx`:

```tsx
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  STAFF_SUBCOLLECTIONS,
  type ModuleDoc,
  type ModuleItem,
  type ModuleProgress,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useEffectiveClaims } from '@/dev/DevModeContext';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/Skeleton';
import { MaterialsSection, ResourceListSection, RichTextSection } from './moduleSections';

export function ModulePage() {
  const { moduleId = '' } = useParams();
  const { user } = useAuth();
  const claims = useEffectiveClaims();
  const emailLower = user?.email?.toLowerCase() ?? '';

  const { data: module, loading: moduleLoading } = useFirestoreDoc<ModuleDoc>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}` : '',
  );
  const { data: myStaff } = useFirestoreDoc<Staff>(
    emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '',
  );
  const { data: items } = useFirestoreCollection<ModuleItem>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}/${'items'}` : '',
  );
  const { data: progress } = useFirestoreCollection<ModuleProgress>(
    emailLower ? `${COLLECTIONS.staff}/${emailLower}/${STAFF_SUBCOLLECTIONS.moduleProgress}` : '',
  );

  const doneItemIds = useMemo(
    () => new Set((progress ?? []).filter((p) => p.status === 'done').map((p) => p.itemId)),
    [progress],
  );

  const isAssigned = useMemo(() => {
    if (claims.isAdmin) return true;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults
    return (myStaff?.modules ?? []).includes(moduleId);
  }, [claims.isAdmin, myStaff, moduleId]);

  function toggleDone(item: ModuleItem, done: boolean) {
    const ref = doc(
      db,
      COLLECTIONS.staff,
      emailLower,
      STAFF_SUBCOLLECTIONS.moduleProgress,
      item.itemId,
    );
    if (done) {
      void setDoc(ref, {
        itemId: item.itemId,
        moduleId: item.moduleId,
        status: 'done',
        completedAt: serverTimestamp(),
      });
    } else {
      void deleteDoc(ref);
    }
  }

  if (moduleLoading && !module) {
    return (
      <PageHeader title="Loading…" variant="plain">
        <Skeleton className="h-40 w-full" />
      </PageHeader>
    );
  }

  if (!module || !module.hasPage || !isAssigned) {
    return (
      <PageHeader title="Module" variant="plain">
        <EmptyState title="This module isn't available to you." />
      </PageHeader>
    );
  }

  return (
    <PageHeader
      title={module.displayName}
      variant="plain"
      subtitle={module.description || undefined}
    >
      <div className="space-y-6">
        {module.sections.length === 0 ? (
          <EmptyState title="This module has no content yet." />
        ) : (
          module.sections.map((section) => {
            if (section.type === 'richtext') {
              return <RichTextSection key={section.id} section={section} />;
            }
            if (section.type === 'resources') {
              return <ResourceListSection key={section.id} section={section} items={items ?? []} />;
            }
            return (
              <MaterialsSection
                key={section.id}
                section={section}
                items={items ?? []}
                doneItemIds={doneItemIds}
                onToggleDone={toggleDone}
              />
            );
          })
        )}
      </div>
    </PageHeader>
  );
}
```

> Note: verify `PageHeader`'s prop API (`title`, `variant`, `subtitle`, children) and `useEffectiveClaims`/`useFirestoreDoc`/`useFirestoreCollection`/`Skeleton` import paths against the codebase; the `${'items'}` is just `MODULE_SUBCOLLECTIONS.items` — import and use that constant instead of the inline string.

- [ ] **Step 3: Register lazy route + prefetch**

In `apps/web/src/lazyRoutes.ts`:

1. Add to the `importers` object (after the `ModulesPage` entry, line 17):

```ts
  ModulePage: () => import('@/modules/ModulePage'),
  ModuleBuilderPage: () => import('@/admin/modules/ModuleBuilderPage'),
```

2. Add the lazy exports near the other `export const ... = lazy(...)` declarations:

```ts
export const ModulePage = lazy(() =>
  importers.ModulePage().then((m) => ({ default: m.ModulePage })),
);
export const ModuleBuilderPage = lazy(() =>
  importers.ModuleBuilderPage().then((m) => ({ default: m.ModuleBuilderPage })),
);
```

3. Add prefetch path entries to `PREFETCH_BY_PATH`:

```ts
  '/admin/modules': 'ModulesPage',
```

(That `/admin/modules` line already exists; no dynamic `:moduleId` paths are added to the static map — dynamic routes are not prefetched by path.)

> `ModuleBuilderPage` is created in Task 7; this import will fail to resolve until Task 7 lands. If Task 7 has not been implemented yet when this task is built, temporarily point the importer at a stub or implement Task 7 first. In subagent-driven execution, sequence Task 7 immediately after Task 6, or implement the `ModuleBuilderPage` file skeleton (Task 7 Step 1) before running typecheck here.

- [ ] **Step 4: Add the routes**

In `apps/web/src/App.tsx`:

1. Add the staff route inside the signed-in `StandardShell` group (the group starting at line 84, alongside `/dashboard` and `/my-rubric`):

```tsx
<Route path="/m/:moduleId" element={<L.ModulePage />} />
```

2. Add the builder route inside the admin group, nested under `/admin` (after the `modules` index route, line 115):

```tsx
<Route path="modules/:moduleId" element={<L.ModuleBuilderPage />} />
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (requires Task 7's `ModuleBuilderPage` to exist — see Step 3 note).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/ apps/web/src/lazyRoutes.ts apps/web/src/App.tsx
git commit -m "feat(modules): staff-facing module page + route + access guard"
```

---

### Task 7 [Wave 1d]: Admin module builder (sections + content editors)

**Files:**

- Create: `apps/web/src/admin/modules/ModuleSectionEditor.tsx`
- Create: `apps/web/src/admin/modules/ModuleBuilderPage.tsx`
- Modify: `apps/web/src/admin/modules/ModulesPage.tsx`

- [ ] **Step 1: Create the section editor**

Create `apps/web/src/admin/modules/ModuleSectionEditor.tsx`. It edits one section's title and its content (rich-text inline, or resource/material rows via the items subcollection), and exposes reorder/delete:

```tsx
import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  MODULE_SUBCOLLECTIONS,
  type ModuleItem,
  type ModuleSection,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TiptapEditor } from '@/components/ui/tiptap-editor';

interface Props {
  moduleId: string;
  section: ModuleSection;
  items: ModuleItem[];
  isFirst: boolean;
  isLast: boolean;
  onPatchSection: (id: string, patch: Partial<ModuleSection>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
}

function newItemId() {
  return `itm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ModuleSectionEditor({
  moduleId,
  section,
  items,
  isFirst,
  isLast,
  onPatchSection,
  onMove,
  onDelete,
}: Props) {
  const { user } = useAuth();
  const sectionItems = items
    .filter((i) => i.sectionId === section.id)
    .slice()
    .sort((a, b) => a.order - b.order);

  function itemRef(itemId: string) {
    return doc(db, COLLECTIONS.modules, moduleId, MODULE_SUBCOLLECTIONS.items, itemId);
  }

  function addItem(kind: ModuleItem['kind']) {
    const itemId = newItemId();
    void setDoc(itemRef(itemId), {
      itemId,
      moduleId,
      kind,
      sectionId: section.id,
      order: sectionItems.length,
      title: kind === 'resource' ? 'New resource' : 'New material',
      description: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user?.email ?? null,
    });
  }

  function patchItem(itemId: string, patch: Partial<ModuleItem>) {
    void setDoc(
      itemRef(itemId),
      { ...patch, updatedAt: serverTimestamp(), updatedBy: user?.email ?? null },
      { merge: true },
    );
  }

  function removeItem(itemId: string) {
    void deleteDoc(itemRef(itemId));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <span className="text-muted-foreground text-xs uppercase">{section.type}</span>
        <Input
          value={section.title}
          placeholder="Section title"
          onChange={(e) => onPatchSection(section.id, { title: e.target.value })}
          className="flex-1"
        />
        <Button
          variant="ghost"
          size="icon"
          disabled={isFirst}
          onClick={() => onMove(section.id, -1)}
          aria-label="Move up"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={isLast}
          onClick={() => onMove(section.id, 1)}
          aria-label="Move down"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          onClick={() => onDelete(section.id)}
          aria-label="Delete section"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {section.type === 'richtext' ? (
          <TiptapEditor
            value={section.body}
            onChange={(html) => onPatchSection(section.id, { body: html })}
          />
        ) : (
          <>
            {sectionItems.map((item) => (
              <div key={item.itemId} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label>Title</Label>
                  <Input
                    value={item.title}
                    onChange={(e) => patchItem(item.itemId, { title: e.target.value })}
                  />
                </div>
                {item.kind === 'resource' ? (
                  <div className="grid gap-1">
                    <Label>Link URL</Label>
                    <Input
                      value={item.linkUrl ?? ''}
                      placeholder="https://…"
                      onChange={(e) => patchItem(item.itemId, { linkUrl: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="grid gap-1">
                    <Label>Due date (optional)</Label>
                    <Input
                      type="date"
                      value={item.dueDate ?? ''}
                      onChange={(e) => patchItem(item.itemId, { dueDate: e.target.value })}
                    />
                  </div>
                )}
                {item.kind === 'material' ? (
                  <div className="grid gap-1 sm:col-span-2">
                    <Label>Description</Label>
                    <Input
                      value={item.description}
                      onChange={(e) => patchItem(item.itemId, { description: e.target.value })}
                    />
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => removeItem(item.itemId)}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => addItem(section.type === 'resources' ? 'resource' : 'material')}
            >
              <Plus className="mr-1 h-4 w-4" />
              {section.type === 'resources' ? 'Add resource' : 'Add material'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

> Note: verify `TiptapEditor`'s actual prop names (it may use `content`/`onUpdate` rather than `value`/`onChange`) against `apps/web/src/components/ui/tiptap-editor.tsx` and adjust. For resource file uploads (vs. links), reuse the Storage upload pattern from `apps/web/src/admin/branding/BrandingPage.tsx` (`storageRef(storage, 'admin-uploads/module-resources/${moduleId}/${itemId}.${ext}')`, `uploadBytes`, `getDownloadURL`) writing the result to `patchItem(itemId, { fileUrl })`. Adding upload UI is optional for v1 if links cover the need; keep link input at minimum.

- [ ] **Step 2: Create the builder page**

Create `apps/web/src/admin/modules/ModuleBuilderPage.tsx`:

```tsx
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  MODULE_ICONS,
  MODULE_SUBCOLLECTIONS,
  type ModuleDoc,
  type ModuleItem,
  type ModuleSection,
  type ModuleSectionType,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModuleSectionEditor } from './ModuleSectionEditor';

function newSectionId() {
  return `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ModuleBuilderPage() {
  const { moduleId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: module } = useFirestoreDoc<ModuleDoc>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}` : '',
  );
  const { data: items } = useFirestoreCollection<ModuleItem>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}/${MODULE_SUBCOLLECTIONS.items}` : '',
  );

  const sections = useMemo<ModuleSection[]>(() => module?.sections ?? [], [module]);

  function patchModule(patch: Partial<ModuleDoc>) {
    void setDoc(
      doc(db, COLLECTIONS.modules, moduleId),
      { ...patch, updatedAt: serverTimestamp(), updatedBy: user?.email ?? null },
      { merge: true },
    );
  }

  function setSections(next: ModuleSection[]) {
    patchModule({ sections: next });
  }

  function addSection(type: ModuleSectionType) {
    setSections([...sections, { id: newSectionId(), type, title: '', body: '' }]);
  }

  function patchSection(id: string, patch: Partial<ModuleSection>) {
    setSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function moveSection(id: string, dir: -1 | 1) {
    const idx = sections.findIndex((s) => s.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= sections.length) return;
    const next = sections.slice();
    [next[idx], next[swap]] = [next[swap]!, next[idx]!];
    setSections(next);
  }

  function deleteSection(id: string) {
    setSections(sections.filter((s) => s.id !== id));
  }

  if (!module) {
    return (
      <PageHeader title="Module" variant="light" breadcrumb={['Admin', 'Modules']}>
        <p className="text-muted-foreground text-sm">Loading…</p>
      </PageHeader>
    );
  }

  return (
    <PageHeader
      title={module.displayName}
      variant="light"
      breadcrumb={['Admin', 'Modules', module.displayName]}
      actions={
        <Button variant="outline" onClick={() => void navigate('/admin/modules')}>
          Back to modules
        </Button>
      }
    >
      <div className="mb-6 grid max-w-xl gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={module.hasPage}
            onChange={(e) => patchModule({ hasPage: e.target.checked })}
            className="h-4 w-4"
          />
          Give this module a staff-facing page + sidebar entry
        </label>

        <div className="grid gap-1">
          <Label>Sidebar icon</Label>
          <select
            value={module.icon}
            onChange={(e) => patchModule({ icon: e.target.value as ModuleDoc['icon'] })}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {MODULE_ICONS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {sections.map((section, idx) => (
          <ModuleSectionEditor
            key={section.id}
            moduleId={moduleId}
            section={section}
            items={items ?? []}
            isFirst={idx === 0}
            isLast={idx === sections.length - 1}
            onPatchSection={patchSection}
            onMove={moveSection}
            onDelete={deleteSection}
          />
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="mt-4">
            <Plus className="mr-1 h-4 w-4" />
            Add section
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => addSection('richtext')}>Rich text</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addSection('resources')}>
            Resource list
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addSection('materials')}>
            Materials / to-dos
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PageHeader>
  );
}
```

> Note: confirm `PageHeader` accepts a 3-element breadcrumb and the `actions` prop; confirm `useFirestoreDoc`/`useFirestoreCollection` paths. All writes are auto-save merges (matching the StaffPage inline-edit pattern the user approved).

- [ ] **Step 3: Wire the module list row → builder**

In `apps/web/src/admin/modules/ModulesPage.tsx`, change the row click from opening the edit dialog to navigating to the builder. Add `import { useNavigate } from 'react-router-dom';`, call `const navigate = useNavigate();` in `ModulesPage`, and change the `AdminDataView` `onRowClick` (currently `onRowClick={(r) => setEditing(r)}`) to:

```tsx
        onRowClick={(r) => void navigate(`/admin/modules/${r.moduleId}`)}
```

Keep the create dialog (`showCreate`) for making new modules (name/id/color/description). After creation it can still navigate into the builder; optionally, in the create dialog's `save()` success path, `navigate(\`/admin/modules/${form.moduleId}\`)`. Add a `hasPage`status hint to the table by adding a column or a`Badge` (optional, low priority).

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Fix any prop-name mismatches flagged by the notes above.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/admin/modules/
git commit -m "feat(admin): no-code module builder — sections + resource/material editors"
```

---

# WAVE 2 — Dashboard merge (serial; depends on Wave 0 + touches dashboard files)

### Task 8: Merge module materials into the dashboard timeline

**Files:**

- Create: `apps/web/src/dashboard/deriveModuleTasks.ts`
- Create: `apps/web/src/dashboard/deriveModuleTasks.test.ts`
- Modify: `apps/web/src/dashboard/deriveCheckpoints.ts`
- Modify: `apps/web/src/dashboard/DashboardView.tsx`
- Modify: `apps/web/src/dashboard/StaffDashboardPage.tsx`

- [ ] **Step 1: Widen the checkpoint type to carry module tasks**

In `apps/web/src/dashboard/deriveCheckpoints.ts`, in the `CheckpointWithStatus` interface:

1. Change `key: CheckpointTypeKey;` to:

```ts
/** Which built-in type generated this entry, or 'module' for a module
 *  material surfaced from an assigned module. */
key: CheckpointTypeKey | 'module';
```

2. After the `ackObservationId?: string;` field add:

```ts
  /** Set for module-material tasks; identifies the /modules/{id}/items doc so
   *  the dashboard's Mark-done writes the right moduleProgress record. */
  moduleItemId?: string;
  /** moduleId for a module-material task (used by the Mark-done write). */
  moduleId?: string;
```

- [ ] **Step 2: Write the failing derivation test**

Create `apps/web/src/dashboard/deriveModuleTasks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ModuleItem } from '@ops/shared';
import { deriveModuleTasks } from './deriveModuleTasks';

const base = {
  moduleId: 'mentor',
  kind: 'material' as const,
  sectionId: 's1',
  order: 0,
  description: '',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const now = new Date('2026-05-20T12:00:00Z');

describe('deriveModuleTasks', () => {
  it('marks a completed material as done', () => {
    const items: ModuleItem[] = [{ ...base, itemId: 'i1', title: 'Read handbook' }];
    const tasks = deriveModuleTasks({ materials: items, doneItemIds: new Set(['i1']), now });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe('done');
    expect(tasks[0]!.moduleItemId).toBe('i1');
  });

  it('marks an item due within a week as soon, later as upcoming', () => {
    const items: ModuleItem[] = [
      { ...base, itemId: 'soon', title: 'Soon', dueDate: '2026-05-23' },
      { ...base, itemId: 'later', title: 'Later', dueDate: '2026-08-01' },
    ];
    const tasks = deriveModuleTasks({ materials: items, doneItemIds: new Set(), now });
    const byId = Object.fromEntries(tasks.map((t) => [t.moduleItemId, t.status]));
    expect(byId['soon']).toBe('soon');
    expect(byId['later']).toBe('upcoming');
  });

  it('treats a no-due-date item as upcoming', () => {
    const items: ModuleItem[] = [{ ...base, itemId: 'nd', title: 'No date' }];
    const tasks = deriveModuleTasks({ materials: items, doneItemIds: new Set(), now });
    expect(tasks[0]!.status).toBe('upcoming');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @ops/web test`
Expected: FAIL — `Cannot find module './deriveModuleTasks'`.

- [ ] **Step 4: Implement the derivation**

Create `apps/web/src/dashboard/deriveModuleTasks.ts`:

```ts
import type { ModuleItem } from '@ops/shared';
import type { CheckpointWithStatus } from './deriveCheckpoints';

const SOON_WINDOW_DAYS = 7;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shortLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Convert a staff member's assigned-module material items into dashboard
 * checkpoint entries. Status comes from stored completion + the item's due
 * date — never inferred from observations.
 */
export function deriveModuleTasks(args: {
  materials: ModuleItem[];
  doneItemIds: Set<string>;
  now?: Date;
}): CheckpointWithStatus[] {
  const now = args.now ?? new Date();
  return args.materials
    .filter((m) => m.kind === 'material')
    .map((m) => {
      const due = parseDate(m.dueDate);
      const done = args.doneItemIds.has(m.itemId);
      let status: CheckpointWithStatus['status'] = 'upcoming';
      if (done) {
        status = 'done';
      } else if (due) {
        const days = (due.getTime() - now.getTime()) / 86_400_000;
        status = days <= SOON_WINDOW_DAYS ? 'soon' : 'upcoming';
      }
      return {
        id: `module-${m.moduleId}-${m.itemId}`,
        key: 'module' as const,
        type: 'form',
        typeLabel: 'Module',
        title: m.title,
        desc: m.description,
        monthLabel: due ? due.toLocaleDateString('en-US', { month: 'short' }) : '',
        dateLabel: due ? shortLabel(due) : '',
        dueRelative: '',
        cta: m.ctaUrl ? 'Open' : '',
        ctaUrl: m.ctaUrl ?? '',
        status,
        completedLabel: null,
        percent: null,
        percentLabel: '',
        moduleItemId: m.itemId,
        moduleId: m.moduleId,
      } satisfies CheckpointWithStatus;
    });
}
```

> Note: confirm `CheckpointVisualType` includes `'form'` (it does — see `BUILTIN_DEFAULTS` in `deriveCheckpoints.ts`). If `type` is a stricter union, pick an existing member.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @ops/web test`
Expected: PASS.

- [ ] **Step 6: Render a Mark-done action for module tasks in `DashboardView`**

In `apps/web/src/dashboard/DashboardView.tsx`, add an optional handler to `DashboardViewProps` (next to `onAcknowledge`):

```ts
  onCompleteModuleItem?: (moduleId: string, itemId: string) => void;
```

Thread it down to the task card the same way `onAcknowledge` is threaded (the grep shows it's spread at lines ~117/131/169 and consumed in the card at ~474-542). In the task-card component, where the acknowledge button is rendered (`isAck && task.ackObservationId && onAcknowledge`), add a sibling branch:

```tsx
{
  task.moduleItemId &&
  task.moduleId &&
  onCompleteModuleItem &&
  task.status !== 'done' &&
  !readOnly ? (
    <button
      type="button"
      className="task__action"
      onClick={() => onCompleteModuleItem(task.moduleId ?? '', task.moduleItemId ?? '')}
    >
      Mark done
    </button>
  ) : null;
}
```

> Match the existing button's className/markup exactly (copy the acknowledge button's element and swap the handler/label) so styling is consistent.

- [ ] **Step 7: Load assigned-module materials + progress and merge in `StaffDashboardPage`**

In `apps/web/src/dashboard/StaffDashboardPage.tsx`:

1. Add imports:

```ts
import { collectionGroup, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { STAFF_SUBCOLLECTIONS, type ModuleItem, type ModuleProgress } from '@ops/shared';
import { deriveModuleTasks } from './deriveModuleTasks';
```

(Merge the firestore imports with the existing `firebase/firestore` import line; `setDoc`/`doc`/`serverTimestamp` are already imported.)

2. Load the viewer's module progress (own subcollection) and assigned-module materials. After the existing `modulesData` load (line 78):

```ts
const { data: moduleProgress } = useFirestoreCollection<ModuleProgress>(
  emailLower ? `${COLLECTIONS.staff}/${emailLower}/${STAFF_SUBCOLLECTIONS.moduleProgress}` : '',
);

// Assigned module IDs (max 30 for the `in` query — staff never have that many).
const assignedModuleIds = useMemo(() => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults
  return (staff?.modules ?? []).slice(0, 30);
}, [staff]);

const materialsConstraints = useMemo(
  () =>
    assignedModuleIds.length > 0
      ? [where('kind', '==', 'material'), where('moduleId', 'in', assignedModuleIds)]
      : null,
  [assignedModuleIds],
);

const [moduleMaterials, setModuleMaterials] = useState<ModuleItem[]>([]);
useEffect(() => {
  if (!materialsConstraints) {
    setModuleMaterials([]);
    return;
  }
  let cancelled = false;
  void getDocs(query(collectionGroup(db, 'items'), ...materialsConstraints)).then((snap) => {
    if (cancelled) return;
    setModuleMaterials(snap.docs.map((d) => d.data() as ModuleItem));
  });
  return () => {
    cancelled = true;
  };
}, [materialsConstraints]);
```

(Add `useEffect`, `useState` to the React import at the top.)

3. Build module tasks and append to the derived checkpoints. After the `tasks` `useMemo` (ends line 158):

```ts
const moduleTasks = useMemo(() => {
  const done = new Set(
    (moduleProgress ?? []).filter((p) => p.status === 'done').map((p) => p.itemId),
  );
  return deriveModuleTasks({ materials: moduleMaterials, doneItemIds: done });
}, [moduleMaterials, moduleProgress]);

const allTasks = useMemo(() => [...tasks, ...moduleTasks], [tasks, moduleTasks]);
```

4. Pass `allTasks` to `DashboardView` instead of `tasks` (the `tasks={tasks}` prop, line ~226 → `tasks={allTasks}`), and wire the Mark-done handler:

```tsx
      onCompleteModuleItem={(moduleId, itemId) => {
        const ref = doc(db, COLLECTIONS.staff, emailLower, STAFF_SUBCOLLECTIONS.moduleProgress, itemId);
        void setDoc(ref, {
          itemId,
          moduleId,
          status: 'done',
          completedAt: serverTimestamp(),
        });
      }}
```

> Note: the `collectionGroup('items')` query needs the index added in Task 4 Step 4 deployed (Wave 3). Until deployed it will error in the console with an index link; that's expected pre-deploy. The `where('moduleId','in', …)` constraint is what makes the recursive read rule pass (every returned doc is in the viewer's modules).

- [ ] **Step 8: Typecheck, lint, and commit**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @ops/web test`
Expected: PASS.

```bash
git add apps/web/src/dashboard/
git commit -m "feat(dashboard): merge assigned module materials into the task timeline"
```

---

# WAVE 3 — Verify, deploy gates, and push

### Task 9: End-to-end verification and push to dev-paul

**Files:** none (verification + deploy + push only)

- [ ] **Step 1: Full static gates**

Run, from repo root:

```bash
pnpm --filter @ops/shared build
pnpm typecheck
pnpm lint
pnpm --filter @ops/shared test
pnpm --filter @ops/web test
pnpm test:rules
pnpm format:check
```

Expected: all PASS. If `format:check` flags any file, run `pnpm format` and re-stage.

- [ ] **Step 2: Deploy rules + indexes to dev so the dashboard query works**

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

Expected: rules deploy succeeds; the `items` collection-group index builds (may take a few minutes — check the Firebase console Indexes tab).

- [ ] **Step 3: Browser smoke test (preview tools)**

Using the dev server / preview:

1. As an admin, go to Admin → Modules → click a module → toggle "Give this module a page", pick an icon, add a Rich text section + a Resources section (add a link) + a Materials section (add a material with a due date).
2. Assign that module to your own staff record (Admin → Staff → your row → add the module).
3. Reload. Confirm the module appears in the sidebar with its icon, `/m/:moduleId` renders the three sections, and the material's "Mark done" toggles a Done badge.
4. Open the dashboard; confirm the material appears as a task in the timeline with the right status and that "Mark done" there also works.
5. Check `preview_console_logs` for errors (especially a missing-index error → wait for the index to finish building).
6. Negative check: a module the viewer is NOT assigned should not appear in the sidebar, and visiting its `/m/:moduleId` should show the "isn't available to you" empty state.

- [ ] **Step 4: Push**

```bash
git push origin dev-paul
```

Then confirm CI + the dev deploy go green for the pushed commit.

---

## Self-review (completed by plan author)

**Spec coverage:**

- A (creating a module makes it assignable/nav-capable) → Tasks 1, 5, 7. ✓
- B (no-code builder: sections, resources, materials) → Tasks 1–3 (schema), 7 (builder). ✓
- C (assigned staff see/open the page) → Tasks 5 (nav), 6 (page + guard), 4 (rules). ✓
- Light configurability (3 section types, reorderable) → `moduleSection` + builder section manager. ✓
- Materials = trackable to-dos w/ completion + due dates → `moduleItem` + `moduleProgress` + `MaterialsSection`/dashboard. ✓
- Per-module page toggle (`hasPage`) → schema + builder + nav filter. ✓
- Firestore-rules content gating + UI hide → Task 4 (rules) + Task 5 (nav filter) + Task 6 (guard). ✓
- Dashboard merge into existing checkpoints → Task 8. ✓
- Any-admin builder → builder lives under the admin-only route group. ✓
- Admin-console alignment (light header/breadcrumb, AdminDataView, Card/Badge/EmptyState, Dialog) → builder uses light `PageHeader`+breadcrumb+Card; staff page uses `variant="plain"`. ✓
- Out-of-scope items (embedded media, per-staff assignment, file-download locking, claims mirroring) → not implemented. ✓

**Type consistency:** `moduleId`/`itemId`/`sectionId`/`hasPage`/`icon`/`sections`/`kind`/`dueDate`/`moduleItemId` are spelled identically across schema, page, builder, derivation, and rules. `MODULE_SUBCOLLECTIONS.items` and `STAFF_SUBCOLLECTIONS.moduleProgress` used consistently. `CheckpointWithStatus.key` widened once (Task 8 Step 1) and the `'module'` literal used in Task 8 Step 4.

**Known verification points** (flagged inline as Notes, not placeholders): exact prop names for `PageHeader`, `Card`/`EmptyState`, `TiptapEditor`, and the `DashboardView` task-card button markup must be matched to the real exports while implementing — these are existing primitives whose APIs the implementer can read directly.
