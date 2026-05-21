# Module System — Design

**Date:** 2026-05-20
**Status:** Approved (design); pending implementation plan

## Goal

Turn modules from cosmetic display chips into a real capability system: a
module can carry a staff-facing page (resources + trackable materials +
rich-text), appear in the sidebar for the staff assigned to it, gate its
content by assignment, and surface its materials in the dashboard task
timeline. Admins build modules and author their content with no code, using a
small palette of reorderable section types ("light configurability").

This delivers the full vision in one design:

- **A** — creating a module makes it an available, assignable capability that
  can drive the staff sidebar.
- **B** — a no-code module builder where admins add sections, upload
  resources, and author assigned materials.
- **C** — when a staff member is assigned a module, they can see and open its
  page from the sidebar, and its materials flow into their dashboard.

## Current state (context)

- **Modules today are display-only.** `/modules/{moduleId}` holds `moduleId`,
  `displayName`, `description`, `color`, `isActive`
  (`packages/shared/src/schema/module.ts`). Staff carry `modules: slugId[]`
  (`packages/shared/src/schema/staff.ts:42`). That array only renders chips on
  the dashboard (`StaffDashboardPage.tsx:184`) and helps filter the staff
  table. No route, no content, no access meaning.
- **Sidebar is hardcoded per-role** in `buildNavItems()`
  (`apps/web/src/components/AppSidebar.tsx:96`); it never reads the user's
  modules.
- **Access is claim-based.** Custom claims (`role`, `isAdmin`,
  `hasSpecialAccess`) are set server-side in
  `apps/functions/src/auth/onStaffWritten.ts:60` from the staff doc. Modules
  are NOT in the claims.
- **Dashboard checkpoints are derived, not stored.** `deriveCheckpoints()`
  (`apps/web/src/dashboard/deriveCheckpoints.ts`) is a pure function: status is
  inferred from observation artifacts; there is no per-staff stored completion
  for tasks. Module materials differ — they need explicit per-staff completion.

## Decisions (from brainstorming)

- **Configurability:** light. Admins pick from a fixed palette of section
  types and order them per module — not a free-form drag-and-drop page builder.
- **Section types (v1):** rich-text block, resource list, materials/to-do
  list. (Embedded media is out for v1.)
- **Materials = trackable to-dos:** completion tracking + optional due dates,
  mirroring the existing dashboard checkpoint model.
- **Per-module page toggle:** each module has a `hasPage` switch. Some modules
  stay display-only chips; others become full pages. Backward compatible.
- **Access enforcement:** Firestore rules gate module content docs by the
  viewer's assigned modules; the sidebar link is also hidden. Uploaded files in
  Storage remain reachable by their (token) URL — acceptable for internal PD
  content, explicitly out of scope to lock down further.
- **Dashboard:** materials merge into the existing checkpoint timeline as
  additional task entries (unified "things to do"), rather than a separate
  section.
- **Builder access:** any admin (`isAdmin`) can create/manage modules and
  author content.

## Data model

### `/modules/{moduleId}` (extended)

New fields, all with backward-safe defaults so existing module docs keep
working unchanged:

- `hasPage: boolean` — default `false`. `false` = display-only chip (today's
  behavior). `true` = module has a staff-facing page and a sidebar entry for
  assigned staff.
- `icon: string` — default `'shapes'`. A lucide icon name chosen from a
  curated allow-list, used for the sidebar entry.
- `sections: ModuleSection[]` — default `[]`. Ordered list defining the page
  layout.

`ModuleSection`:

- `id: string` — stable slug/uuid for the section.
- `type: 'richtext' | 'resources' | 'materials'`
- `title: string` — heading shown on the page.
- `body?: string` — rich-text HTML, present only for `type === 'richtext'`
  (stored inline; small).

Existing fields (`moduleId`, `displayName`, `description`, `color`,
`isActive`, `createdAt`, `updatedAt`, `updatedBy`) are unchanged.

### `/modules/{moduleId}/items/{itemId}` (new subcollection)

Resource and material content items. Separate docs (not nested arrays) so they
scale and so rules can gate them independently.

- `kind: 'resource' | 'material'`
- `sectionId: string` — which section this item renders under.
- `order: number` — position within the section.
- `title: string`
- Resource-only: `fileUrl?: string` (Storage download URL), `linkUrl?: string`
  (external link). At least one is present.
- Material-only: `description: string` (default `''`), `dueDate?: string`
  (ISO date), `ctaUrl?: string` (optional deep link).
- `createdAt`, `updatedAt`.

### `/staff/{email}/moduleProgress/{itemId}` (new subcollection)

Per-staff completion for material items, stored under the staff member's own
doc so rules are simple (a staff member reads/writes only their own progress).

- `itemId: string`
- `moduleId: string`
- `status: 'done'`
- `completedAt: timestamp`

Absence of a doc = not done.

## Access & navigation

- **Dynamic sidebar entries.** `buildNavItems()` gains a module-driven group.
  For each module in `staff.modules` with `hasPage === true`, render a nav
  entry to `/m/:moduleId` using the module's `icon` and `displayName`. Applies
  to every role (the dynamic group is appended to whatever the role-specific
  layout already produces). Modules data is already loaded elsewhere; the
  sidebar will read it via the existing `useFirestoreCollection` hook.
- **New route `/m/:moduleId`** renders the staff-facing module page (lazy
  route, added to the router + `PREFETCH_BY_PATH` map).
- **Route guard.** The module page verifies the viewer is assigned the module
  (their `/staff` doc's `modules` includes `moduleId`) or is admin; otherwise
  it shows a not-authorized/empty state. This is UX; real enforcement is in
  rules (below).

## Staff-facing module page

A generic renderer walks `module.sections` in order and renders each by type:

- `richtext` → render the section `body` HTML (same sanitization/render path
  used by other rich-text surfaces).
- `resources` → list the `kind === 'resource'` items for that `sectionId`
  (ordered), each opening its `fileUrl`/`linkUrl` in a new tab.
- `materials` → list the `kind === 'material'` items for that `sectionId`,
  each with title, description, optional due date, and a **Mark done** control
  that writes/deletes `/staff/{email}/moduleProgress/{itemId}`.

Uses the existing admin/page primitives: `PageHeader` (light variant), `Card`,
`EmptyState`, `Badge`.

## Admin module builder

Extends the existing Modules admin area
(`apps/web/src/admin/modules/ModulesPage.tsx`). The module edit dialog/screen
grows:

- Existing fields (display name, id, description, color, active) plus the new
  `hasPage` toggle and an **icon picker** (curated lucide allow-list).
- A **section manager**: add a section (choose `richtext` / `resources` /
  `materials`), set its title, reorder (up/down), and delete. Order persists to
  `module.sections`.
- **Per-section content editors:**
  - richtext → TipTap editor writing to the section `body`.
  - resources → rows of (title + file upload to Storage or pasted link);
    create/edit/delete `items` docs with `kind: 'resource'`.
  - materials → rows of (title, description, optional due date); create/edit/
    delete `items` docs with `kind: 'material'`.

Any admin (`isAdmin`) can use it. Saves write to the module doc and its `items`
subcollection.

## Dashboard merge (materials → checkpoints)

Module materials become additional entries in the same `tasks` array the
dashboard already renders, so they live in the unified timeline/list rather
than a separate section.

- A new derivation produces `CheckpointWithStatus`-shaped entries from the
  viewer's assigned modules' material `items`.
- `status` is computed from stored `moduleProgress` (`done`) and the item's
  `dueDate` (`soon` when near/overdue, `upcoming` otherwise) — explicitly NOT
  inferred from observations the way built-in checkpoints are.
- These entries are appended to `deriveCheckpoints()` output and sorted into
  the timeline by due date alongside the built-ins.
- The **Mark done** action reuses the existing acknowledge-card interaction
  pattern (a per-task action that writes completion and refreshes).
- A material with no `dueDate` still appears as an `upcoming`/`soon` task
  without a timeline date (consistent with how built-ins render "Awaiting
  date").

The merge logic is additive and isolated so it does not change the behavior of
the existing observation-derived checkpoints.

## Security rules

- `/modules/{id}` — read: any signed-in staff (needed for chips, nav, and
  page metadata); write: admin only.
- `/modules/{id}/items/{itemId}` — read: admin, OR the requester's
  `/staff/{requester-email}` doc has `id` in its `modules` array; write: admin
  only.
- `/staff/{email}/moduleProgress/{itemId}` — read/write: that staff member
  (`email == request.auth.token.email`), and admin.
- Composite indexes added as needed for any `items` queries that combine
  `where` + `orderBy` on different fields (follow the existing pattern of
  equality-only filters + client-side sort where it avoids an index).
- Out of scope: locking down Storage file downloads (files stay reachable by
  their token URL).

## Components & files touched

- **Schema (`@ops/shared`):** extend `moduleDoc` (`hasPage`, `icon`,
  `sections` + `ModuleSection`); new `moduleItem` schema; new `moduleProgress`
  schema; add collection-name/icon-allow-list constants. Rebuild the shared
  package (web imports built `dist`).
- **New staff page:** module page renderer + section components + route +
  guard + prefetch entry.
- **Sidebar:** dynamic module nav group in `AppSidebar.tsx`.
- **Admin builder:** extend `ModulesPage.tsx` / module dialog with section
  manager + content editors (resource upload reuses the existing Storage
  upload path from the Branding work).
- **Dashboard:** new materials→checkpoints derivation; wire into
  `StaffDashboardPage.tsx`; render path reuses `DashboardView`.
- **Rules/indexes:** `firestore.rules`, `firestore.indexes.json`.

## Implementation shape (waves, for parallel subagent execution)

- **Wave 0 (serial foundation):** all `@ops/shared` schema additions + build
  the shared package. Everything depends on this.
- **Wave 1 (parallel, disjoint files):**
  - [a] admin builder UI (`apps/web/src/admin/modules/*`)
  - [b] staff module page + route + guard (`apps/web/src/modules/*` + router)
  - [c] dynamic sidebar nav (`AppSidebar.tsx`)
  - [d] security rules + indexes (`firestore.rules`, `firestore.indexes.json`)
- **Wave 2 (serial-ish):** dashboard materials→checkpoints merge (touches
  `deriveCheckpoints.ts` + `StaffDashboardPage.tsx`).
- **Wave 3:** end-to-end browser verification, typecheck + lint + format,
  commit, push to dev-paul.

## Success criteria

- Creating/marking a module `hasPage` with sections produces a working
  staff-facing page at `/m/:moduleId`.
- A staff member assigned that module sees its entry in the sidebar and can
  open the page; an unassigned staff member cannot see the link and cannot read
  its `items` (rules-enforced).
- Admins can add/reorder sections and author rich-text, resources (upload or
  link), and materials with due dates — no code.
- Assigned materials appear in the staff dashboard timeline with correct
  done/soon/upcoming status and a working Mark-done action.
- Existing modules (no `hasPage`) behave exactly as before; existing dashboard
  checkpoints are unchanged.
- Zero regressions to current module chips, staff table filtering, or the
  observation-derived checkpoints.

## Out of scope

- Free-form drag-and-drop page builder / arbitrary block types (only the three
  v1 section types).
- Embedded media sections (video/doc embeds).
- Per-staff individual material assignment (materials apply to everyone
  assigned the module).
- Storage file-level download protection (signed/token-checked URLs).
- Mirroring modules into custom claims.
- Module-based gating of any existing pages (e.g. admin console) beyond the new
  module pages themselves.

## Rollout

1. Wave 0 schema + shared build.
2. Wave 1 parallel build (builder, page, nav, rules).
3. Wave 2 dashboard merge.
4. Verify in browser preview; typecheck + lint + format; push to dev-paul.
