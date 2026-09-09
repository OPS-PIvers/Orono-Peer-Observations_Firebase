# Dashboard editor UX + group-targeted resources — handoff — 2026-09-09

Design handoff for two related pieces of work on `/admin/dashboard`, agreed in a design session on
2026-09-09. **No code has been written.** This document is the complete decision record: a fresh
session should be able to implement both PRs from it without the original conversation.

**Problem as reported.** The admin dashboard editing view is unusable. The preview pane takes most of
the screen, the editor column is too narrow to read what you are typing, and fields drift out of view
while editing. Separately, there is no way to show a resource to only some staff (year 1, year 2,
probationary, etc.).

**Method.** Code reading plus two exploration passes over `apps/web/src/admin/`,
`apps/web/src/dashboard/` and `packages/shared/src/schema/`. Nothing was run in a browser and nothing
was written to Firestore. Every claim below carries a `file:line` so the implementer can re-check
rather than trust it — this project has a documented history of confident-but-false premises (see
`docs/ADMIN_CONSOLE_AUDIT.md`).

---

## Findings that drove the design

These were verified by reading the code. Re-check any you intend to rely on.

**1. The layout ratio contradicts the file's own documentation.**
`apps/web/src/admin/dashboard/DashboardSettingsPage.tsx:29` documents "tab content (60%), live preview
(40%)". The actual grid at `:116` is `lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]` — 33% editor, 67%
preview. Someone intended editor-favoring and the code drifted the other way.

**2. Three stacked scroll/sticky contexts.**
Sticky action bar at `DashboardSettingsPage.tsx:55`; editor column `overflow-y-auto` at `:120`; and the
preview's own scroller at `apps/web/src/admin/dashboard/DashboardPreview.tsx:114`, wrapping a
CSS-`zoom`-scaled 1240px render (`DashboardPreview.tsx:82`, `:117`). The editor's nested scroller is the
second scrollbar the user sees and the reason fields slide out from under them.

**3. Save writes data that violates its own schema.**
`apps/web/src/admin/dashboard/useDashboardDraft.ts:135` — `save()` does a raw `setDoc` of
`draft.quickMaterials` with **no zod parse anywhere**. But `add()` at
`apps/web/src/admin/dashboard/QuickMaterialsEditor.tsx:110` creates
`{ label: '', sub: '', icon: 'doc', url: '' }`, while the schema declares
`label: z.string().trim().min(1)` at `packages/shared/src/schema/dashboard.ts:224`. Clicking "Add
material" and saving writes a contract-violating document. `url` is `z.string().trim().max(2048)` with
no URL check at all, so a typo'd link saves silently too. This is a live bug, not a hypothetical.

**4. Dashboard is the only admin page with a real editor+preview split.**
Branding uses a fixed 240px static swatch aside (`apps/web/src/admin/branding/BrandingPage.tsx:79`) with
no nested scroll. Email Templates renders its preview as an iframe _below_ the body editor
(`apps/web/src/admin/email-templates/EmailTemplatesPage.tsx:809`). Modules, rubrics, work-product and
signup-fields have no preview at all. `apps/web/src/admin/_shared/` contains only data-table helpers —
there is no layout primitive today, and a new one would ship with exactly one consumer.

**5. Quick materials live in their own document.**
`dashboardQuickMaterials/global` — collection constant `packages/shared/src/constants.ts:27`, doc id
`packages/shared/src/schema/dashboard.ts:238`. Not on `appSettings/dashboard`. Read at
`apps/web/src/dashboard/StaffDashboardPage.tsx:90-91`, rendered in the right rail at
`apps/web/src/dashboard/DashboardView.tsx:767-808`. Rules: `firestore.rules:403-410` — domain-readable,
admin-writable. Schema is flat `{label, sub, icon, url}` with **no targeting fields**.

**6. Roles and buildings are stored differently, and it matters.**
`staff.role` holds the **`roleId` slug**, matched by exact case-sensitive equality
(`apps/web/src/utils/roleLookup.ts:11-17`); the admin form writes `option value={r.roleId}`
(`apps/web/src/admin/staff/StaffDialog.tsx:315`). But `staff.buildings` holds **`displayName` strings**,
not ids — stated outright at `packages/shared/src/schema/building.ts:11-16` and confirmed at
`apps/web/src/admin/staff/StaffFilterBar.tsx:165-167`, `StaffDialog.tsx:131-137`,
`StaffInlineEditors.tsx:123-151`. CSV import does no building mapping at all
(`apps/web/src/admin/staff/staffCsv.ts:297-304`). Expect a tail of legacy "unmapped" values on both.

**7. The exact filter semantics we want already exist, unshared.**
`apps/web/src/admin/staff/StaffPage.tsx:150-172` implements OR-within-dimension /
AND-across-dimensions with empty-set-means-inactive. The same logic is hand-written twice more, in
`apps/web/src/observations/CreateObservationWindowDialog.tsx:192-211` and
`EditObservationWindowDialog.tsx:129-137`. No shared predicate exists.
`apps/web/src/admin/_shared/FilterChip.tsx` + `DropdownMenuCheckboxItem` is the house multi-select
control. Note the staff page has **no** cycle-status filter and **no** module filter — those two
dimensions are new UI.

**8. Existing targeting precedent is strictly weaker than what we're building.**
`packages/shared/src/schema/module.ts:74-81` — a module's `autoEnable` matches on exactly ONE criterion
(one cycle status OR one display year), never both, never multiple values. Matcher at
`module.ts:114-130`, mirrored by hand in `firestore.rules:59-77`. `staffMatchesAutoEnable` is the only
exported matching helper in `packages/shared/src`.

**9. Pre-existing silent data loss in the path module-targeting depends on.**
`apps/web/src/dashboard/StaffDashboardPage.tsx:111` — effective modules are truncated with
`.slice(0, 30)` to satisfy Firestore's `in` limit. Materials from the 31st module onward silently never
render. **Deliberately out of scope for both PRs below** — see "Spun off".

---

## PR 1 — Make the editor usable

Independent of PR 2 and ships first. Small, low-risk, unblocks daily use.

**Layout.** Draggable splitter between editor and preview. Default **60/40 editor-favoring** (today:
33/67). Position persisted in `localStorage` per browser, with min/max clamps. Built **inline** on
`DashboardSettingsPage` with the splitter logic in a local hook — deliberately **not** extracted to
`admin/_shared/`, because per finding 4 it would have exactly one consumer and the API would be a guess.
Extract later when a real second consumer appears.

**Scrolling.** Delete the editor column's `overflow-y-auto` (`DashboardSettingsPage.tsx:120`). One page
scrollbar; the preview stays sticky. The splitter controls **width only**. This is the actual fix for
"fields slide out from under me" — the splitter alone does not fix it.

**Field-level pass, all three tabs** (Layout, Cycle steps, Quick materials — Cycle steps is the densest
at 379 lines and benefits most):

- Labels larger than the current `text-xs`.
- URL fields that show the **tail** of a long Drive link, not just the head.
- Inline error display.

**Validation.** `save()` runs the zod schema **before** `setDoc`. On failure: block the write, name the
offending card and field, and switch to the tab containing it. Fixes finding 3.

**Known behavior change — call this out in the PR description.** After this PR, a half-filled material
card blocks saving until it is completed or deleted. The production editor currently contains blank
"New material" cards, so the first thing an admin sees on the new build is a refused save. This is
correct behavior and was accepted knowingly, but it will read as a regression for the first thirty
seconds.

---

## PR 2 — Group-targeted resources

**Surface.** Dashboard **quick materials** get an optional audience rule. Chosen over a new standalone
resource library (more code) and over reusing modules (resources would land on a module page rather than
the dashboard). Note per finding 5 the field goes on `dashboardQuickMaterials/global`, not
`appSettings/dashboard`.

**Dimensions.** Five: **years, cycle statuses, buildings, roles, modules.**

**Combination semantics.** **OR within a dimension, AND across dimensions.** `{Year 1, Year 2} + {OMS}`
means "a year-1 or year-2 person who is also at OMS". Adding a chip in a new dimension **narrows** the
audience. An empty dimension is unconstrained; an entirely empty audience means everyone. This mirrors
`StaffPage.tsx:150-172` exactly (finding 7).

_Accepted cost:_ pure-union targeting ("year 1s plus everyone at OMS" in one material) is not
expressible. Rejected alternatives were OR-everywhere (can't express "year 1s at OMS specifically") and
a per-material any/all toggle (a boolean-logic control on every card).

**Reference formats** (finding 6 — do not unify these; the storage genuinely differs):

- Buildings → store **`displayName`**. Matches `staff.buildings` and every other building reference in
  the app. Storing `buildingId` would look more stable but isn't: staff docs still hold names, so a
  rename breaks the match one layer down either way, while inventing a second convention costs clarity.
- Roles → store **`roleId`** slug. Render `displayName` via `roleLookup.ts`.
- Modules → the **effective** set: manual `staff.modules` ∪ `autoEnable` matches, the same union the
  dashboard and sidebar already compute (`StaffDashboardPage.tsx:104-112`). Anything else creates two
  meanings of "in the Mentor module".
- Cycle statuses → offer the four current `CYCLE_STATUSES` (`packages/shared/src/cycle.ts:11`). Do
  **not** offer the retired `'low'` (`LEGACY_CYCLE_STATUS`, `cycle.ts:21`), but the matcher must widen it
  to planning-or-developing if an old stored value appears, matching `module.ts:124`.
- Years → note the overlap: probationary staff have stored year 4-6 which _displays_ as 1-3
  (`cycle.ts:28-32`). `{Year 1, Probationary}` therefore means "continuing year-1s plus all probationary
  staff".

**Enforcement — display filter only.** Non-matching staff simply don't see the card; the payload still
reaches the browser. **No `firestore.rules` change**; `dashboardQuickMaterials/global` stays
domain-readable per `firestore.rules:403-410`. Justification: these are Drive links already shared
district-wide, and rules cannot filter fields inside a single document — enforcement would require
splitting the doc apart. If a genuinely sensitive resource ever needs it (e.g. probationary-only
improvement plans), that is a follow-up, and `firestore.rules:59-77` shows the mirroring pattern.

**Matcher.** One `staffMatchesAudience(staff, audience)` in `packages/shared`, used by **both** the staff
dashboard render path and the admin preview so they cannot drift. Deliberately **do not** refactor the
three existing duplicate call sites (finding 7) in this PR — they work, and touching the staff list and
observation-window flows expands the blast radius. Worth a follow-up.

**Editor UI.** Each material card gains **one collapsed line**: `Visible to: Everyone ▾` or
`Visible to: Year 1, Year 2 · OMS ▾`. Click expands the picker in place. Zero added height at rest —
this matters, since five always-visible chip groups would make each card enormous in the very editor
whose cramping started this. The summary line doubles as the at-a-glance audience badge. Build the picker
from `admin/_shared/FilterChip.tsx` + `DropdownMenuCheckboxItem`, matching the staff page.

**Live match count.** The picker shows `Matches N of M staff` as chips toggle. Requires loading the staff
roster into the dashboard admin page; follow `StaffPage.tsx:116`'s `useDeferredValue` pattern to keep it
responsive. A rule matching zero people otherwise looks identical to one matching everyone.

**"Preview as".** A popover in the preview header setting all five dimensions on the sample staff member,
so the preview filters live. Chosen over a year+status-only control (understates the rest) and over
previewing as a real staff member (pulls the live roster into the preview). It is the only version that
shows what someone matching two rules at once sees.

**Edge cases:**

- **Stale chips fail open.** A chip naming a deleted or renamed building, role or module stops
  constraining anything, and the admin editor flags it on that card. Under AND-across, honoring it
  strictly would hide the material from **everyone**, silently, because someone renamed a building — the
  worst available outcome. Buildings are the realistic case here, per finding 6.
- **Nobody matches → no card.** If a staff member matches none of the materials, the Quick Materials side
  card does not render at all (`DashboardView.tsx:248-251` is already section-gated). An empty labelled
  panel reads as a broken feature.
- **Back-compat.** Existing materials have no audience field; the zod default is an empty audience, which
  means everyone. No migration needed.

**Tests.** Unit coverage for the matcher and the editor, following the
`packages/shared/src/schema/module.test.ts` pattern. No new e2e specs.

---

## Spun off — not in either PR

**The 30-module truncation.** `apps/web/src/dashboard/StaffDashboardPage.tsx:111` silently drops
everything past a staff member's 30th effective module (finding 9). Module-dimension targeting rides on
that array, so it is adjacent — but it is pre-existing, not caused by this work, and a silent-data-loss
fix deserves its own review rather than riding along in a layout PR. Fix by chunking the `in` query into
batches of 30 and merging results, keeping the surrounding hook's loading/error semantics. Add a test for
the >30 case.

While there: the same effective-module union is recomputed independently in at least four places with no
shared helper — `StaffDashboardPage.tsx:104-112` (30-capped), `StaffDashboardPage.tsx:281-291`
(`moduleChips`, uncapped), `apps/web/src/components/AppSidebar.tsx:283-299`, and
`apps/web/src/admin/staff/StaffInlineEditors.tsx:176-208`. `firestore.rules:59-77` mirrors the matching
by hand.

**Collapsing the three duplicate filter predicates** onto `staffMatchesAudience` once PR 2 lands.

---

## Scope limits of this handoff

- **Nothing was run.** No browser, no dev server, no Firestore write. Findings 1-9 are code-reading only.
  Finding 3 in particular (save writes invalid data) is asserted from the code path and has **not** been
  reproduced against a live Firestore.
- **Visual and interaction feel is not specified.** The layout decisions above are structural (ratios,
  scroll model, where controls live). Actual spacing, typography scale and drag-handle affordance are left
  to the implementer.
- **The 60/40 default is a judgement, not a measurement.** It was chosen because it is what
  `DashboardSettingsPage.tsx:29` already claims the layout does, and because 40% of a wide screen is
  roughly 700px, which should be adequate for the preview's scaled 1240px render. Nobody looked at it in a
  browser. Verify before considering the layout PR done.
