---
target: admin Staff page
total_score: 22
max_score: 40
na_heuristics:
p0_count: 1
p1_count: 3
timestamp: 2026-08-29T01-11-11Z
slug: apps-web-src-admin-staff-staffpage-tsx
---

Method: dual-agent (A: a5df2da27107987f3 · B: a26d201d8eeb088f8)
Target: apps/web/src/admin/staff/StaffPage.tsx — Admin → Staff. Mode: Operate.
Measured live at http://localhost:5173/admin/staff, 242 real records (224 active / 18 archived), at 1440x900 and 390x844.

## Design Health Score — 22/40 (Needs work)

| #         | Heuristic                       | Score     | Key issue                                                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Visibility of System Status     | 2         | No success feedback anywhere: sonner ships in App.tsx but Staff never calls it; archive writes silently; zero aria-live on the page (grep across admin/staff + admin/\_shared returns 0 hits). Counters and the bulk-dialog progress line are the only status.                                                        |
| 2         | Match System / Real World       | 3         | Domain vocabulary is genuinely correct (tenure, probationary, summative, cycle). Mobile sort labels every column "(A-Z)" including numeric Year and Module Access.                                                                                                                                                    |
| 3         | User Control and Freedom        | 1         | No undo anywhere. No confirm on a 224-record bulk write or on row-menu Archive. Filters/sort/selection are useState with no URL sync — one refresh discards all of it.                                                                                                                                                |
| 4         | Consistency and Standards       | 2         | Three sibling flows, three safety models (rollover: full preview; message: two-step confirm; bulk edit: none). StaffFilterBar hand-rolls the search input instead of the shared AdminSearchInput, losing its clear button and aria-label. Desktop bulk bar omits the role="toolbar" + aria-label its mobile twin has. |
| 5         | Error Prevention                | 1         | StaffDialog.save() does no duplicate-email check and writes setDoc(..., {merge:true}) keyed on email — re-creating an archived person silently overwrites the record and flips isActive back to true. The 200-recipient email cap is only discovered after selecting 224.                                             |
| 6         | Recognition Rather Than Recall  | 3         | Filter chips carry active summaries and counts; row pills are directly editable. But nothing recalls why 18 rows are missing.                                                                                                                                                                                         |
| 7         | Flexibility and Efficiency      | 2         | Inline pill editing is a real fast path. Zero keyboard shortcuts, no "select first 200", no saved views, no deep links.                                                                                                                                                                                               |
| 8         | Aesthetic and Minimalist Design | 2         | At 1440px the bulk bar wraps to two rows (measured 104px); with 109px of page chrome that is 213px — 25% of the 848px scrollport — permanently sticky.                                                                                                                                                                |
| 9         | Error Recovery                  | 2         | bulkMerge commits in 500-doc chunks; a mid-run throw sets error and clears progress, so a partial write is never reported. MessageGroupDialog's template-missing state is exemplary by contrast.                                                                                                                      |
| 10        | Help and Documentation          | 4         | Genuinely excellent. RolloverDialog teaches the cycle rules in plain language; bulk add/remove explain their set semantics; unmapped roles/modules get inline "(unmapped)" affordances with a Remove link.                                                                                                            |
| **Total** |                                 | **22/40** | **Needs work**                                                                                                                                                                                                                                                                                                        |

## Design Specificity Verdict

Split: the dialogs are deeply product-specific, the page shell around them is a generic SaaS admin table.

The domain knowledge is real and lives almost entirely in RolloverDialog.tsx — the cycle rules ("tenured staff loop 1 to 2 to 3 to 1... probationary advance P1 to P2 to P3 and then earn tenure"), the per-row current-to-next preview with a "Gains tenure" badge, four blast-radius pills, stale-write reconciliation. None of that lifts into another product. Same for staffCycle's Low/High/Probationary vocabulary and NeverSignedInCard's "221 of your active staff have not signed in yet."

Category-interchangeable: the table is stock shadcn (zebra rows, ArrowUpDown affordances, per-row kebab, pill filter chips). The header cluster is the generic Select / Export / Import / Add quintet with the two daily actions at opposite ends of three infrequent ones. BulkEditDialog is a pure field-setter that never knows it is editing teachers. The empty state is one bare sentence in a td colspan=7 while EmptyState supports icon, description, and action.

Missed product character: the cycle is the product and the table hides it across two narrow columns (Year, Status) instead of one "Y3 · Summative" reading. Building is the organizing unit of a district and is only a filter chip — no grouping, no per-building counts. NeverSignedInCard is the most product-specific element on the page and is stranded above the filter bar, not wired to filter the table.

### Deterministic scan

CLI detect.mjs: 18 findings (exit 2). 16 x `side-tab` (border-l-4) across BulkEditDialog:393, MessageGroupDialog:179/192/202/242/251, RolloverDialog:186/229/311, StaffDialog:470, StaffImportDialog:205/211/253/296, StaffPage:286/292 — all 16 are false positives: they are semantic error/success/confirm callouts on tinted backgrounds, the canonical accepted use of a left rule, internally consistent in one shape and three colors. The real issue underneath is duplication: 16 hand-repeated class strings for what should be one Callout component with variants. 2 x `design-system-font-size` survive: StaffDialog.tsx:370 and PillEditor.tsx:194 both render load-bearing 10px text off the ramp.

In-page detector (injected successfully, 10 findings): only skipped-heading is on-surface (H1 "Staff" then H3 "Invited but never signed in", no H2). The 5 undersized-ui-text and 1 gray-on-color hits are admin shell/sidebar, outside target. Overlays were painted (8) and then removed; the live server was started in the background and stopped (taskkill, verified dead), so no overlay is visible in the browser now.

### Where the two assessments agreed

Both independently measured the 654px header action row inside a 390px viewport, and both flagged 10px text. The detector caught the heading skip that the design review also found. The detector missed everything that actually matters here — the confirmation gaps, the invisible filter, the transparent focus ring — which is the honest summary of what a class-name scanner can and cannot see.

## Overall Impression

This page knows its domain better than most district software ever does, and it protects the once-a-year operation far better than the everyday one. RolloverDialog is genuinely excellent design. Two clicks away, "set 224 staff Inactive" is a plain blue button with no confirmation, no destructive styling, and no undo. That inversion — the rare action guarded, the frequent dangerous action bare — is the single biggest opportunity on the page, and it is days from launch.

## What's Working

1. RolloverDialog is a model of high-stakes design: it refuses to write until you confirm, quantifies the blast radius four ways, allows per-row dissent, deliberately does not re-key its preview on the live snapshot so a concurrent edit cannot clobber your opt-outs mid-review, then reconciles server-side and names the skipped people by email. Conflict, staleness, and partial success are all first-class states.
2. The color system is accessible without looking clinical. Every pair measured by canvas readback with full alpha compositing passes: lowest on the surface is 5.40:1 (muted email on a striped row), pills run 6.37-13.9:1, the blue bulk bar's white text is 13.82:1. Zero contrast failures, and the color still carries meaning rather than decoration.
3. The mobile bulk bar is better designed than the desktop one: role="toolbar", a live-updating aria-label, three actions plus More, fixed to the bottom with env(safe-area-inset-bottom), and pb-20 added only while a selection exists so it never covers the last card. Measured 129px clearance at max scroll.

## Priority Issues

### [P0] Three of five header actions are off-screen on a phone — "Add staff" is unreachable

Why it matters: at 390x844 the action row measures 654px inside a 390px container because PageHeader wraps it in shrink-0, defeating the flex-wrap on its parent. "Annual rollover" sits at x 396-548 and "Add staff" beyond it; elementFromPoint returns the container, not the button. document.scrollWidth is 390, so there is no page-level scrollbar — the overflow lives on main (scrollWidth 670 vs clientWidth 390), reachable only by an undiscoverable horizontal swipe across vertically-scrolling content. A principal who opens Staff on their phone to add a mid-year hire cannot. Nine elements overflow the right edge.

Fix: drop shrink-0 from PageHeader.tsx and let the actions wrap. On Staff, collapse Export CSV / Import CSV / Annual rollover into one "More" DropdownMenu below md, leaving Select and Add staff inline — exactly the pattern BulkEditBar already uses on mobile.

Suggested command: /impeccable adapt

### [P1] A 224-record bulk mutation has no confirmation, no destructive styling, and no undo

Why it matters: BulkEditDialog renders "Apply to 224" as a default primary — measured rgb(52,61,136), enabled, one click from write. Setting Inactive archives the entire district roster and locks everyone out; "Set admin access" then Grant hands 224 people the admin console. Neither has a second step, destructive styling, an undo, or a post-write confirmation. The two neighbouring flows (rollover, message group) both guard themselves properly, so admins arrive expecting a safety net that is not there.

Fix: for isActive: false, hasAdminAccess: true, and summativeYear, add the confirm step MessageGroupDialog already implements — Continue then "Set 224 staff to Inactive? This cannot be undone." — with variant="destructive" on the final button. Above ~25 rows, require typing the count. Cheapest partial fix: destructive variant plus the "cannot be undone" line.

Suggested command: /impeccable harden

### [P1] The default Active filter hides 18 people with no visual evidence, and the recovery path overwrites data

Why it matters: DEFAULT_STATUS_FILTER = 'active' suppresses 18 of 242 records, and StaffFilterBar excludes the default from activeChipCount — so the Status chip renders in its inactive white state and "Clear filters" never appears. Confirmed live: searching "ARNOLD" reports "1 of 242 staff" and shows only ARNOLD, TIM; ARNOLD, ANDREA is archived and invisible. Then StaffDialog.save() does no duplicate check and writes setDoc(..., {merge: true}) keyed on email, so the admin who cannot find Andrea and re-creates her silently overwrites the archived record and reactivates her. An invisible filter becomes silent data loss.

Fix: (a) count the default in activeChipCount so the chip reads "Status · Active" in its active state whenever it filters; (b) when a search returns fewer rows than an unfiltered search would, append "· 1 archived match hidden — show archived" to the subtitle and the empty state; (c) in StaffDialog.save() create mode, look the email up first and offer "Andrea Arnold already exists (archived) — restore instead?"

Suggested command: /impeccable clarify

### [P1] 1,120 inline editors have no focus indicator, and the table is invisible to a screen reader

Why it matters: PillEditor.tsx:41 declares focus-visible:ring-2 + ring-ring but omits ring-offset-2, so --tw-ring-shadow computes to `0 0 0 calc(2px + 0px)` — a zero-spread ring that composites to fully transparent. Measured: all five box-shadow layers rgba(0,0,0,0). Every sibling that renders a ring includes ring-offset-2; this is the only one in the target that does not. Blast radius: 5 pills x 224 rows = 1,120 focusable controls with zero focus indication, desktop and mobile. Around it: no aria-sort on any of the 7 th (verified before and after sorting), no scope, no caption, no accessible name on the table, no aria-live for either the result count or the selection count, mobile select-all falls back to the string "Some selected" as its name, and row checkboxes are named "Select row" rather than by person. 1,372 focusable elements inside main with no pagination, no virtualization, and no skip link. Row checkboxes and all 1,120 pills measure 18x18 and 20px tall — below WCAG 2.2 AA's 24x24 minimum (2.5.8), which matters for a public school district.

Fix: add focus-visible:ring-offset-2 to PillEditor.tsx:41 (one line, 1,120 controls). Add focus classes to SortableHeader, which currently declares none. Add aria-sort to TableHead in AdminDataView, a visually-hidden aria-live="polite" announcing "224 of 242 staff" and "224 selected", a caption or aria-label on the table, staff names in checkbox labels, and a padded hit-wrapper bringing checkbox and pill targets to at least 24x24. Paginate at 50/page or virtualize to fix the tab-order depth.

Suggested command: /impeccable audit

### [P2] Every keystroke in search blocks the main thread for 86-463ms

Why it matters: all 224 rows render at once — 6,286 elements in tbody, 95% of the page's DOM, main.scrollHeight 14,172px (16.7 screens; 48,778px and 57.7 screens on mobile), with 1,120 Radix popover triggers and 224 dropdown triggers mounted simultaneously. Measured blocking time inside the input dispatch: 463ms cold, 211ms for the first character, 344ms to clear back to 224 rows. Cost tracks rendered row count, not input length. At 60wpm most keystrokes drop.

Fix: paginate at 50 rows or virtualize the body; debounce the search value; make the pill editors render their Popover content lazily on open rather than mounting 1,120 triggers.

Suggested command: /impeccable optimize

## Persona Red Flags

Alex (impatient power user): zero keyboard shortcuts — no "/" to focus search, no Esc to leave Select mode, no Cmd+A; confirmed no key handlers in StaffPage. Toggling Select mode calls setSelected(new Set()) on both enter and exit, so clicking Done to read a row and clicking Select again destroys 224 selections. Select-all (224) then Message group hits the 200-recipient cap with Continue disabled and no "select first 200" — you close the dialog and deselect 24 people by hand with no guidance on which. Row-menu Archive writes instantly while StaffDialog's Archive button only stages local state and still needs Save — the same word behaving two ways on one page. No bulk "copy emails" despite per-row copy existing.

Sam (screen reader, keyboard-only, low vision): contrast passes everywhere (lowest 5.40:1) and the design-system ring works on chips, toolbar, search, and bulk bar — then 1,120 pill editors render no ring at all, and sortable headers fall through to the UA default. No skip link; the first three anchors are nav items, and getting past the table takes roughly 1,350 Tab presses. Nothing announces that a search returned 0 of 242 or that 224 rows are selected. No aria-sort, so the current sort is unknowable by ear. Heading order jumps H1 to H3. Checkboxes at 18x18 fail WCAG 2.2 target size.

Riley (stress tester): mid-flow refresh loses all filters, sort, and selection (useState, no URL sync). Long names are handled well — truncation, max-w chips, break-words on mobile cards. Concurrent edits are only reconciled in RolloverDialog; BulkEditDialog snapshots selectedRows and would write a patch derived from data another admin has since changed. bulkMerge commits in 500-doc chunks and a mid-run throw discards the progress count, so the user learns it failed but not how many of 224 already committed. StaffPage filters selectedRows from unfiltered staff while toggleAll operates on filtered visibleIds, so a selection can outlive the filter that created it. The 0-row empty state is one unstyled sentence with no icon, no description, no action, and no clear-search control — because the hand-rolled input dropped AdminSearchInput's clear button.

## Minor Observations

- BulkEditBar.tsx:279: `{count === 1 ? 'staff' : 'staff'}` — dead ternary, both branches identical.
- BulkEditDialog claims "Applying to N staff members" even for add/remove building, where bulkMergePerRow skips no-op rows; the stated count is not the number changed.
- AdminDataView hardcodes "(A-Z)"/"(Z-A)" for numeric sorts, so mobile offers "Year (A-Z)".
- StatusPill's sortAccessor sorts on `summativeYear ? 1 : 0` — a boolean — so sorting by Status yields two indistinguishable blocks, not the three-way Low/High/Probationary order the column displays.
- RolloverDialog and MessageGroupDialog use raw green-600/green-50 rather than the ops-\* token family; the app's only success color is off-system.
- The 16 border-l-4 callouts should be one Callout component with three variants.
- Console and network are clean: zero errors, zero warnings, all requests 200.
- Sticky headers verified correct in both states: chrome 109px, bulk bar 104px, th top computes 109px then 213px, rect lands at 161 then 265 with no gap or overlap. The recent fix works exactly as designed; its cost is that 25% of the scrollport is now chrome when the 9-button bar wraps.
- Unverified, needs a manual check: the row actions dropdown may not close on Escape. Assessment B could not isolate whether this is real or an artifact of driving Radix programmatically.

## Questions to Consider

1. The team demonstrably knows how to design for consequence — rollover gets a preview, a per-row veto, and stale-write reconciliation. What made the frequent destructive path feel like it did not need the same treatment? Was bulk edit built as a generic field-setter and never re-examined once its most dangerous fields were added to it?
2. How many of this page's problems are one problem — that it tracks a count it never explains? What breaks if the subtitle becomes the honest sentence "224 shown · 18 archived hidden"?
3. The constraint made the mobile bulk bar better than the desktop one. If you built the desktop bar to the mobile bar's budget — three actions and an overflow — which three would you pick, and does having to argue about it prove the nine-button bar was never a decision?
