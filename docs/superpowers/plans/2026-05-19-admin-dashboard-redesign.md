# Admin Console → Dashboard Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the developer-feeling `/admin/dashboard` page with a modern, non-technical-user-friendly editor: single Save action with unsaved-changes detection, plain-English copy throughout, visual selectable section toggles, drag-and-drop reordering, a visual icon picker for Quick Materials, and a live side-by-side preview of the staff dashboard rendered with the current draft config.

**Architecture:** Two-column page layout — tabbed editor (Layout / Cycle steps / Quick materials) on the left, live `<DashboardView>` preview rendering with in-memory draft state on the right. A single `useDashboardDraft` hook owns the draft snapshot, dirty-state detection, and the Save action. The current `StaffDashboardPage` is refactored: render logic moves into a pure `<DashboardView>` component that takes config + quick materials + observations + staff as props, so the admin preview can pass *draft* values while the live page passes *Firestore* values — same JSX, two callers.

**Tech Stack:** React 19 + TypeScript, shadcn/ui primitives, Tailwind 4, `@dnd-kit/sortable` (drag-and-drop), existing Firestore hooks (`useFirestoreDoc`), lucide-react icons, `DashboardIcon` SVG set.

**Scope check:** This is a single subsystem (one admin page + a refactor of one staff page). One plan is appropriate.

**Estimated effort:** 6–8 hours.

---

## File Structure

**New files:**

| File | Responsibility |
|---|---|
| `apps/web/src/dashboard/DashboardView.tsx` | Pure render component for the staff dashboard. Takes config + quickMaterials + tasks + sections + staff + pe as props. No Firestore hooks. Used by both the live page and the admin preview. |
| `apps/web/src/admin/dashboard/copyStrings.ts` | All plain-English labels, blurbs, phase names, tooltips. Single source for the rewrite. |
| `apps/web/src/admin/dashboard/useDashboardDraft.ts` | Hook managing the draft snapshot of config + quick materials. Tracks dirty state, exposes a single `save()` that writes both Firestore docs in parallel. |
| `apps/web/src/admin/dashboard/SortableItem.tsx` | Thin wrapper around `useSortable` from `@dnd-kit/sortable`. Forwards transform/transition props to a render-prop child. |
| `apps/web/src/admin/dashboard/IconPicker.tsx` | Visual icon picker — popover with a grid of icon buttons. Renders `DashboardIcon` glyphs, not text. |
| `apps/web/src/admin/dashboard/SectionTilesEditor.tsx` | Section toggles as clickable tiles. Each tile shows the section's preview icon + name + status pill. |
| `apps/web/src/admin/dashboard/CycleStepsEditor.tsx` | Drag-and-drop checkpoint list. Each row: drag handle, visual on/off switch, phase chip, plain-English title and description, click-to-expand label overrides. |
| `apps/web/src/admin/dashboard/QuickMaterialsEditor.tsx` | Drag-and-drop card list. Each card: drag handle, IconPicker, title input, optional subtitle input, URL input, mini preview of the rendered chip, delete button. |
| `apps/web/src/admin/dashboard/DashboardPreview.tsx` | Right-column live preview. Renders `<DashboardView>` inside a scrollable scaled-down container with a header banner. |

**Modified files:**

| File | Change |
|---|---|
| `apps/web/src/admin/dashboard/DashboardSettingsPage.tsx` | Complete rewrite — two-column layout, tabs, single sticky Save action, uses `useDashboardDraft`. |
| `apps/web/src/dashboard/StaffDashboardPage.tsx` | Refactor — extract rendering into `<DashboardView>`; this file becomes thin (Firestore hooks + ack mutation + `<DashboardView>` invocation). |
| `apps/web/package.json` | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` deps. |

**Deleted files:** none — the existing page is replaced in place.

---

## Verification idiom

Each task ends with the same loop:

```bash
pnpm --filter @ops/shared build
pnpm --filter @ops/web typecheck
npx eslint --fix <files touched in this task>
```

For UI tasks, also drive a quick browser check via the running Vite preview (`http://localhost:5173`):

```bash
pnpm dev   # in a separate terminal, or via Claude Code's preview_start
```

Then visit the relevant route in a real browser tab or via `preview_eval` to confirm the new component renders.

After all tasks: full validate.

```bash
pnpm validate
```

---

### Task 1: Install drag-and-drop dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install `@dnd-kit` packages**

```bash
pnpm --filter @ops/web add @dnd-kit/core@^6.3.0 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2
```

Expected: pnpm writes the three deps under `apps/web/package.json#dependencies` and updates the lockfile. Each one resolves cleanly with no warnings beyond the usual deprecated-subdep noise.

- [ ] **Step 2: Verify the installed versions**

```bash
grep -E '"@dnd-kit/' apps/web/package.json
```

Expected output:

```
    "@dnd-kit/core": "^6.3.0",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
```

- [ ] **Step 3: Confirm typecheck still passes**

```bash
pnpm --filter @ops/web typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add @dnd-kit packages for sortable lists"
```

---

### Task 2: Centralize plain-English copy

**Files:**
- Create: `apps/web/src/admin/dashboard/copyStrings.ts`

- [ ] **Step 1: Write the copy module**

Create `apps/web/src/admin/dashboard/copyStrings.ts`:

```ts
import type { CheckpointTypeKey, DashboardSectionsConfig } from '@ops/shared';

/**
 * Single source for every human-facing string on the admin Dashboard
 * page. Edit here, not in component bodies. Anything technical (e.g.
 * "observation.preObsDate") stays out of this file — these are the
 * sentences a peer evaluator or teacher would read.
 */

export const PAGE_TITLE = 'Dashboard';
export const PAGE_SUBTITLE =
  "Decide what staff see when they sign in. Toggle pieces on or off, drag steps into order, and post a few helpful links — staff dates and progress come from the system automatically.";

export const SAVE_BUTTON_DEFAULT = 'Saved';
export const SAVE_BUTTON_DIRTY = 'Save changes';
export const SAVE_BUTTON_SAVING = 'Saving…';
export const UNSAVED_PILL = 'Unsaved changes';

export const TABS = {
  layout: 'Layout',
  steps: 'Cycle steps',
  materials: 'Quick materials',
} as const;

export type TabKey = keyof typeof TABS;

// ── Section tiles ───────────────────────────────────────────────────────────

interface SectionCopy {
  title: string;
  description: string;
}

export const SECTION_COPY: Record<keyof DashboardSectionsConfig, SectionCopy> = {
  hero: {
    title: 'Welcome banner',
    description: "Big greeting, progress ring, and the staff member's year/tier.",
  },
  timeline: {
    title: 'Year-at-a-glance bar',
    description: 'Horizontal track from fall to spring showing where they are in the cycle.',
  },
  filterBar: {
    title: 'Filter chips',
    description: 'Quick tabs: All · Active now · Upcoming · Completed.',
  },
  quickMaterials: {
    title: 'Side panel — Quick materials',
    description: 'Right-hand column of evergreen links you set up below.',
  },
  peerEvaluatorCard: {
    title: 'Side panel — Peer evaluator card',
    description: "Contact card for the staff member's assigned peer evaluator.",
  },
};

// ── Cycle steps (checkpoints) ───────────────────────────────────────────────

interface CheckpointCopy {
  phase: 'Schedule' | 'Visit' | 'Reflect' | 'Sign-off';
  title: string;
  whenItShows: string;
  whatItDoes: string;
}

export const CHECKPOINT_COPY: Record<CheckpointTypeKey, CheckpointCopy> = {
  signup: {
    phase: 'Schedule',
    title: 'Sign up for an observation window',
    whenItShows: 'Always shown until staff have a peer-evaluator-created observation.',
    whatItDoes: "Links to the scheduling form you set under Settings → Sign-up link. Marks done once a peer evaluator creates the staff member's observation.",
  },
  preObs: {
    phase: 'Schedule',
    title: 'Pre-observation conversation',
    whenItShows: 'Appears once the observation is finalized.',
    whatItDoes: 'Shows the meeting date staff had with their peer evaluator before the observation.',
  },
  workProduct: {
    phase: 'Schedule',
    title: 'Work-product responses',
    whenItShows: 'Only when the staff member has an active Work Product observation.',
    whatItDoes: 'Progress bar showing how many of the work-product questions the staff member has answered.',
  },
  observation: {
    phase: 'Visit',
    title: 'Classroom observation',
    whenItShows: 'Appears once the observation is finalized.',
    whatItDoes: 'Shows the date the peer evaluator visited the classroom.',
  },
  instructionalRound: {
    phase: 'Visit',
    title: 'Instructional round',
    whenItShows: 'Only when the staff member has an active Instructional Round.',
    whatItDoes: 'Progress bar tied to the instructional-round response form.',
  },
  reviewDraft: {
    phase: 'Reflect',
    title: 'Review the draft observation',
    whenItShows: 'While a Work Product or Instructional Round draft is open.',
    whatItDoes: 'Lets staff jump into the in-progress observation to read and comment.',
  },
  postObs: {
    phase: 'Reflect',
    title: 'Post-observation conversation',
    whenItShows: 'Appears once the observation is finalized.',
    whatItDoes: 'Shows the meeting date staff had with their peer evaluator after the observation.',
  },
  acknowledge: {
    phase: 'Sign-off',
    title: 'Acknowledge the finalized observation',
    whenItShows: 'Once the observation is finalized.',
    whatItDoes: 'Adds an Acknowledge button staff click to sign off on their record.',
  },
};

export const PHASE_ORDER = ['Schedule', 'Visit', 'Reflect', 'Sign-off'] as const;
export type PhaseKey = (typeof PHASE_ORDER)[number];

export const PHASE_DESCRIPTION: Record<PhaseKey, string> = {
  Schedule: 'Before the observation.',
  Visit: 'The observation itself.',
  Reflect: 'Right after the visit.',
  'Sign-off': 'Closing out the cycle.',
};

// ── Quick materials editor ──────────────────────────────────────────────────

export const QM_HEADING = 'Quick materials sidebar';
export const QM_BLURB =
  'Evergreen links shown in the right side panel of every staff dashboard — paste in a Drive share URL, your rubric link, the district handbook, etc. Drag a card to reorder.';
export const QM_EMPTY = "No materials yet. Use 'Add link' to create the first one.";
export const QM_ADD = 'Add link';
export const QM_FIELD_TITLE = 'Title';
export const QM_FIELD_SUBTITLE = 'Subtitle (optional)';
export const QM_FIELD_URL = 'URL';
export const QM_ICON_PICKER = 'Icon';
export const QM_REMOVE = 'Remove material';

// ── Cycle step editor row ───────────────────────────────────────────────────

export const CS_SHOW_LABEL = 'Show this step to staff';
export const CS_CUSTOMIZE_TOGGLE = 'Rename';
export const CS_CUSTOMIZE_HIDE = 'Hide rename';
export const CS_LABEL_CHIP = 'Chip text';
export const CS_LABEL_TITLE = 'Card title';
export const CS_LABEL_CTA = 'Button text';
export const CS_PLACEHOLDER_DEFAULT = '(use default)';

// ── Section tiles ───────────────────────────────────────────────────────────

export const ST_HEADING = 'Page layout';
export const ST_BLURB =
  'Pick which pieces of the staff dashboard render. Click a tile to switch it on or off.';
export const ST_ON = 'On';
export const ST_OFF = 'Off';

// ── Cycle steps section ─────────────────────────────────────────────────────

export const CS_HEADING = 'Cycle steps';
export const CS_BLURB =
  "Each step shows up only when it applies to a staff member — work-product appears only if they have an active work-product observation, and so on. Toggle a step off to hide it for everyone. Drag to reorder within the list.";
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @ops/web typecheck
```

Expected: pass.

- [ ] **Step 3: Lint and format**

```bash
npx eslint --fix apps/web/src/admin/dashboard/copyStrings.ts
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/admin/dashboard/copyStrings.ts
git commit -m "feat(admin-dashboard): centralize plain-English copy strings"
```

---

### Task 3: Extract `<DashboardView>` from StaffDashboardPage

**Files:**
- Create: `apps/web/src/dashboard/DashboardView.tsx`
- Modify: `apps/web/src/dashboard/StaffDashboardPage.tsx`

- [ ] **Step 1: Define the `DashboardView` props and component**

Create `apps/web/src/dashboard/DashboardView.tsx`:

```tsx
import { useState } from 'react';
import {
  type DashboardQuickMaterial,
  type DashboardSectionsConfig,
  type Staff,
} from '@ops/shared';
import { DashboardIcon } from './DashboardIcon';
import { type CheckpointWithStatus, initialsFromName } from './deriveCheckpoints';
import './dashboard.css';

/**
 * Pure rendering of the staff dashboard chrome. No Firestore hooks; all
 * data arrives via props. Used by:
 *
 *   1. `StaffDashboardPage` — wires live Firestore data.
 *   2. `DashboardPreview` (admin) — wires *draft* config so admins can
 *      see edits before saving.
 *
 * The Acknowledge button is wired through `onAcknowledge`, which the
 * admin preview leaves undefined (preview is read-only).
 */

export type FilterKey = 'all' | 'active' | 'upcoming' | 'completed';

export interface DashboardViewProps {
  staff: Staff;
  firstName: string;
  yearTierLabel: string;
  cycleYearLabel: string;
  cycleCloseLabel: string;
  sections: DashboardSectionsConfig;
  tasks: CheckpointWithStatus[];
  quickMaterials: DashboardQuickMaterial[];
  peerEvaluator: { name: string; email: string; role: string } | null;
  onAcknowledge?: (observationId: string) => void;
  acknowledging?: boolean;
  /** When true, disable interactive CTAs (Send-a-message, Acknowledge,
   *  external links). Used by the admin preview pane. */
  readOnly?: boolean;
}

export function DashboardView(props: DashboardViewProps): React.ReactElement {
  const { sections, tasks, quickMaterials, peerEvaluator, readOnly = false } = props;
  const [filter, setFilter] = useState<FilterKey>('all');

  const completed = tasks.filter((t) => t.status === 'done');
  const active = tasks.filter((t) => t.status === 'inprogress' || t.status === 'soon');
  const upcoming = tasks.filter((t) => t.status === 'upcoming');
  const featured = active[0] ?? upcoming[0] ?? null;
  const restActive = featured && active.includes(featured) ? active.slice(1) : active;
  const restUpcoming = upcoming.filter((t) => t !== featured);

  const counts = {
    total: tasks.length,
    done: completed.length,
    active: active.length,
    upcoming: upcoming.length,
  };

  return (
    <div className="staff-dashboard">
      <div className="page">
        {sections.hero ? (
          <Hero
            firstName={props.firstName}
            staff={props.staff}
            tasks={tasks}
            cycleYearLabel={props.cycleYearLabel}
            yearTierLabel={props.yearTierLabel}
            cycleCloseLabel={props.cycleCloseLabel}
            showTimeline={sections.timeline}
          />
        ) : null}
        {sections.filterBar ? (
          <FilterBar filter={filter} setFilter={setFilter} counts={counts} />
        ) : null}

        <div className="page-grid" style={{ marginTop: 20 }}>
          <div>
            {filter === 'all' ? (
              <>
                {featured ? (
                  <section style={{ marginBottom: 8 }}>
                    <TaskCard
                      task={featured}
                      featured
                      onAcknowledge={props.onAcknowledge}
                      acknowledging={props.acknowledging}
                      readOnly={readOnly}
                    />
                  </section>
                ) : null}
                {restActive.length > 0 ? (
                  <TaskGroup title="In progress" count={restActive.length}>
                    {restActive.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onAcknowledge={props.onAcknowledge}
                        acknowledging={props.acknowledging}
                        readOnly={readOnly}
                      />
                    ))}
                  </TaskGroup>
                ) : null}
                <TaskGroup title="Upcoming" count={restUpcoming.length}>
                  {restUpcoming.length > 0 ? (
                    restUpcoming.map((t) => <TaskCard key={t.id} task={t} readOnly={readOnly} />)
                  ) : (
                    <p className="empty-note">Nothing else scheduled.</p>
                  )}
                </TaskGroup>
                {completed.length > 0 ? (
                  <TaskGroup
                    title="Completed"
                    count={completed.length}
                    action="Show all →"
                    onAction={() => setFilter('completed')}
                  >
                    {completed.slice(0, 3).map((t) => (
                      <MiniTask key={t.id} task={t} />
                    ))}
                  </TaskGroup>
                ) : null}
              </>
            ) : null}

            {filter === 'active' ? (
              <TaskGroup title="Active now" count={active.length}>
                {active.length > 0 ? (
                  active.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      onAcknowledge={props.onAcknowledge}
                      acknowledging={props.acknowledging}
                      readOnly={readOnly}
                    />
                  ))
                ) : (
                  <p className="empty-note">Nothing active right now.</p>
                )}
              </TaskGroup>
            ) : null}

            {filter === 'upcoming' ? (
              <TaskGroup title="Upcoming" count={upcoming.length}>
                {upcoming.length > 0 ? (
                  upcoming.map((t) => <TaskCard key={t.id} task={t} readOnly={readOnly} />)
                ) : (
                  <p className="empty-note">No upcoming checkpoints.</p>
                )}
              </TaskGroup>
            ) : null}

            {filter === 'completed' ? (
              <TaskGroup title="Completed" count={completed.length}>
                {completed.length > 0 ? (
                  completed.map((t) => <MiniTask key={t.id} task={t} />)
                ) : (
                  <p className="empty-note">Nothing completed yet.</p>
                )}
              </TaskGroup>
            ) : null}
          </div>

          <aside className="sidebar">
            {sections.quickMaterials ? (
              <QuickMaterials items={quickMaterials} readOnly={readOnly} />
            ) : null}
            {sections.peerEvaluatorCard ? (
              <EvaluatorCard pe={peerEvaluator} readOnly={readOnly} />
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

// ───── Internal sub-components — copied verbatim from StaffDashboardPage,
// with `readOnly` threaded through so the admin preview can disable CTAs.

function ProgressRing({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const r = 78;
  const c = 2 * Math.PI * r;
  const dash = c * (pct / 100);
  return (
    <div className="dash-hero__ring">
      <svg viewBox="0 0 180 180">
        <circle className="dash-hero__ring-track" cx="90" cy="90" r={r} />
        <circle
          className="dash-hero__ring-fill"
          cx="90"
          cy="90"
          r={r}
          strokeDasharray={`${String(dash)} ${String(c)}`}
        />
      </svg>
      <div className="dash-hero__ring-center">
        <div className="dash-hero__ring-num">
          {value}
          <span className="dash-hero__ring-pct">/{total}</span>
        </div>
        <div className="dash-hero__ring-label">of {total} checkpoints</div>
      </div>
    </div>
  );
}

interface HeroProps {
  firstName: string;
  staff: Staff;
  tasks: CheckpointWithStatus[];
  cycleYearLabel: string;
  yearTierLabel: string;
  cycleCloseLabel: string;
  showTimeline: boolean;
}
function Hero(p: HeroProps) {
  const done = p.tasks.filter((t) => t.status === 'done').length;
  const total = p.tasks.length;
  const next = p.tasks.find((t) => t.status === 'inprogress' || t.status === 'soon');
  return (
    <section className="dash-hero">
      <div className="dash-hero__top">
        <div className="dash-hero__copy">
          <span className="dash-hero__eyebrow">
            {p.staff.summativeYear ? 'Summative cycle' : 'Formative cycle'} · {p.cycleYearLabel}
          </span>
          <h1 className="dash-hero__title">Welcome back, {p.firstName}.</h1>
          <p className="dash-hero__lead">
            {next ? (
              <>
                {done} of {total} checkpoints done. Next up:{' '}
                <strong style={{ color: 'var(--ot-blue-dark)' }}>{next.title.toLowerCase()}</strong>
                .
              </>
            ) : total > 0 ? (
              <>Cycle complete — nice work, {p.firstName}.</>
            ) : (
              <>No active checkpoints right now.</>
            )}
          </p>
          <div className="dash-hero__meta">
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{p.yearTierLabel}</span>
              <span className="dash-hero__meta-label">
                {p.staff.summativeYear ? 'Summative' : 'Formative'}
              </span>
            </div>
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{done}</span>
              <span className="dash-hero__meta-label">Completed</span>
            </div>
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{p.cycleCloseLabel}</span>
              <span className="dash-hero__meta-label">Cycle close</span>
            </div>
          </div>
        </div>
        <ProgressRing value={done} total={Math.max(total, 1)} />
      </div>
      {p.showTimeline ? <Timeline tasks={p.tasks} cycleYearLabel={p.cycleYearLabel} /> : null}
    </section>
  );
}

function Timeline({
  tasks,
  cycleYearLabel,
}: {
  tasks: CheckpointWithStatus[];
  cycleYearLabel: string;
}) {
  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const fillPct =
    total > 0 ? Math.max(4, Math.min(96, (done / total) * 100 + (100 / total) * 0.4)) : 0;
  if (total === 0) return null;
  return (
    <section className="timeline timeline--embedded">
      <div className="timeline__head">
        <div className="timeline__title">Your year at a glance</div>
        <div className="timeline__year">{cycleYearLabel}</div>
      </div>
      <div className="timeline__track">
        <div className="timeline__seasons">
          <div className="timeline__season">
            <span className="timeline__season-label">Fall</span>
          </div>
          <div className="timeline__season">
            <span className="timeline__season-label">Winter</span>
          </div>
          <div className="timeline__season">
            <span className="timeline__season-label">Spring</span>
          </div>
        </div>
        <div className="timeline__rail">
          <div className="timeline__rail-fill" style={{ width: `${String(fillPct)}%` }} />
        </div>
        {tasks.map((t, i) => {
          const left = ((i + 0.5) / total) * 100;
          const isCurrent = t.status === 'inprogress' || t.status === 'soon';
          const cls = [
            'timeline__dot',
            t.status === 'done' ? 'is-done' : '',
            isCurrent ? 'is-current' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={t.id} className={cls} style={{ left: `${String(left)}%` }}>
              {t.monthLabel ? <span className="timeline__dot-date">{t.monthLabel}</span> : null}
              <div className="timeline__dot-pin" />
              {isCurrent && t.dateLabel ? (
                <span className="timeline__dot-label">{t.dateLabel}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface Counts {
  total: number;
  done: number;
  active: number;
  upcoming: number;
}
function FilterBar({
  filter,
  setFilter,
  counts,
}: {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  counts: Counts;
}) {
  const opts: { id: FilterKey; label: string; count: number; tone: string }[] = [
    { id: 'all', label: 'All', count: counts.total, tone: 'neutral' },
    { id: 'active', label: 'Active now', count: counts.active, tone: 'active' },
    { id: 'upcoming', label: 'Upcoming', count: counts.upcoming, tone: 'upcoming' },
    { id: 'completed', label: 'Completed', count: counts.done, tone: 'done' },
  ];
  return (
    <div className="filter-bar" role="tablist" aria-label="Filter checkpoints">
      {opts.map((o) => (
        <button
          key={o.id}
          role="tab"
          type="button"
          aria-selected={filter === o.id}
          className={`filter-bar__btn filter-bar__btn--${o.tone} ${filter === o.id ? 'is-active' : ''}`}
          onClick={() => setFilter(o.id)}
        >
          <span className="filter-bar__label">{o.label}</span>
          <span className="filter-bar__count">{o.count}</span>
        </button>
      ))}
      {filter !== 'all' ? (
        <button type="button" className="filter-bar__reset" onClick={() => setFilter('all')}>
          Reset ×
        </button>
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  featured,
  onAcknowledge,
  acknowledging,
  readOnly,
}: {
  task: CheckpointWithStatus;
  featured?: boolean;
  onAcknowledge?: (observationId: string) => void;
  acknowledging?: boolean;
  readOnly?: boolean;
}) {
  const statusClass = `is-${task.status}`;
  const typeClass = `task__type-chip--${task.type}`;
  const isAck = !!task.ackObservationId;
  return (
    <article className={`task ${statusClass} ${featured ? 'task--featured' : ''}`}>
      <div
        className="task__check"
        role="checkbox"
        aria-checked={task.status === 'done'}
        tabIndex={0}
      />
      <div className="task__body">
        <div className="task__head">
          <h3 className="task__title">{task.title}</h3>
          <span className={`task__type-chip ${typeClass}`}>{task.typeLabel}</span>
        </div>
        {task.desc ? <p className="task__desc">{task.desc}</p> : null}
        {task.status === 'inprogress' && task.percent != null ? (
          <div className="task__progress">
            <div className="task__progress-bar">
              <div className="task__progress-fill" style={{ width: `${String(task.percent)}%` }} />
            </div>
            <span className="task__progress-text">
              {task.percent}%{task.percentLabel ? ` · ${task.percentLabel}` : ''}
            </span>
          </div>
        ) : null}
      </div>
      <div className="task__side">
        <div className="task__due">
          <span className="task__due-label">{task.status === 'done' ? 'Completed' : 'Due'}</span>
          <span className="task__due-date">
            {task.status === 'done' ? (task.completedLabel ?? '') : task.dateLabel}
          </span>
          {task.dueRelative ? <span className="task__due-relative">{task.dueRelative}</span> : null}
        </div>
        {task.status !== 'done' ? (
          isAck && task.ackObservationId && onAcknowledge && !readOnly ? (
            <button
              type="button"
              className={`ot-btn ${featured ? 'ot-btn--primary' : 'ot-btn--secondary'} ot-btn--sm task__cta`}
              onClick={() => onAcknowledge(task.ackObservationId ?? '')}
              disabled={acknowledging}
            >
              {acknowledging ? 'Acknowledging…' : task.cta}
            </button>
          ) : task.ctaUrl && !readOnly ? (
            <a
              href={task.ctaUrl}
              {...(task.ctaUrl.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
              className={`ot-btn ${featured ? 'ot-btn--primary' : 'ot-btn--secondary'} ot-btn--sm task__cta`}
            >
              {task.cta}
              <DashboardIcon name="arrow-right" size={12} />
            </a>
          ) : (
            <button
              type="button"
              disabled={readOnly}
              className={`ot-btn ${featured ? 'ot-btn--primary' : 'ot-btn--secondary'} ot-btn--sm task__cta`}
            >
              {task.cta}
              <DashboardIcon name="arrow-right" size={12} />
            </button>
          )
        ) : (
          <button type="button" className="ot-btn ot-btn--tertiary ot-btn--sm" disabled={readOnly}>
            View
          </button>
        )}
      </div>
    </article>
  );
}

function MiniTask({ task }: { task: CheckpointWithStatus }) {
  return (
    <article className="task task--mini is-done">
      <div className="task__check" />
      <div>
        <h3 className="task__title">{task.title}</h3>
      </div>
      <div className="task__due">
        <span className="task__due-date" style={{ fontSize: 13, fontWeight: 500 }}>
          {task.completedLabel ?? ''}
        </span>
      </div>
      <button type="button" className="ot-btn ot-btn--tertiary ot-btn--sm">
        View
      </button>
    </article>
  );
}

function TaskGroup({
  title,
  count,
  children,
  action,
  onAction,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <section>
      <div className="section-head">
        <div className="section-head__title">
          {title}
          <span className="section-head__count">{count}</span>
        </div>
        {action ? (
          <button type="button" className="section-head__action" onClick={onAction}>
            {action}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function EvaluatorCard({
  pe,
  readOnly,
}: {
  pe: { name: string; email: string; role: string } | null;
  readOnly: boolean;
}) {
  return (
    <div className="side-card">
      <div className="side-card__eyebrow">Your peer evaluator</div>
      {pe ? (
        <>
          <div className="evaluator">
            <div className="evaluator__avatar">{initialsFromName(pe.name, pe.email)}</div>
            <div>
              <h3 className="evaluator__name">{pe.name}</h3>
              {pe.role ? <p className="evaluator__role">{pe.role}</p> : null}
            </div>
          </div>
          <div className="evaluator__contacts">
            <div className="evaluator__row">
              <DashboardIcon name="mail" size={14} />
              {readOnly ? <span>{pe.email}</span> : <a href={`mailto:${pe.email}`}>{pe.email}</a>}
            </div>
          </div>
          {!readOnly ? (
            <a
              href={`mailto:${pe.email}`}
              className="ot-btn ot-btn--primary ot-btn--sm"
              style={{ width: '100%' }}
            >
              Send a message
            </a>
          ) : null}
        </>
      ) : (
        <p className="empty-note">
          No active observation in this cycle yet — your assigned peer evaluator will appear here
          once they create your first observation.
        </p>
      )}
    </div>
  );
}

function QuickMaterials({
  items,
  readOnly,
}: {
  items: DashboardQuickMaterial[];
  readOnly: boolean;
}) {
  return (
    <div className="side-card">
      <div className="side-card__eyebrow">Quick materials</div>
      {items.length === 0 ? (
        <p className="empty-note">No materials posted yet.</p>
      ) : (
        <div className="material-list">
          {items.map((m, i) => {
            const Tag = m.url && !readOnly ? 'a' : 'span';
            return (
              <Tag
                key={i}
                className="material-list__item"
                {...(m.url && !readOnly ? { href: m.url, target: '_blank', rel: 'noreferrer' } : {})}
              >
                <div className="material-list__icon">
                  <DashboardIcon name={m.icon} size={16} />
                </div>
                <div>
                  <div className="material-list__title">{m.label}</div>
                  {m.sub ? <span className="material-list__sub">{m.sub}</span> : null}
                </div>
                <div className="material-list__arrow">
                  <DashboardIcon name="arrow-right" size={14} />
                </div>
              </Tag>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Refactor `StaffDashboardPage.tsx` to use `<DashboardView>`**

Replace the entire body of the file with the version below (keeps the hooks and ack mutation, deletes the duplicated sub-components — they now live in `DashboardView.tsx`):

```tsx
import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { doc, limit, orderBy, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  type AppSettings,
  type DashboardConfig,
  type DashboardQuickMaterial,
  type DashboardQuickMaterialsDoc,
  type DashboardSectionsConfig,
  type Observation,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/Skeleton';
import { DashboardView } from './DashboardView';
import {
  type CheckpointWithStatus,
  deriveCheckpoints,
  extractFirstName,
} from './deriveCheckpoints';

const DEFAULT_SECTIONS: DashboardSectionsConfig = {
  hero: true,
  timeline: true,
  filterBar: true,
  quickMaterials: true,
  peerEvaluatorCard: true,
};

function yearTierLabelFor(year: number): string {
  if (year >= 4) return `Probationary Y${String(year - 3)}`;
  return `Year ${String(year)}`;
}

function currentSchoolYearLabel(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 7 ? year : year - 1;
  return `${String(startYear)} — ${String(startYear + 1)}`;
}

export function StaffDashboardPage() {
  const { user } = useAuth();
  const emailLower = user?.email?.toLowerCase() ?? '';
  const queryClient = useQueryClient();

  const staffPath = emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '';
  const { data: staff, loading: staffLoading } = useFirestoreDoc<Staff>(staffPath);

  const configPath = `${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`;
  const { data: config } = useFirestoreDoc<DashboardConfig>(configPath);

  const quickPath = `${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`;
  const { data: quick } = useFirestoreDoc<DashboardQuickMaterialsDoc>(quickPath);

  const settingsPath = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;
  const { data: appSettings } = useFirestoreDoc<AppSettings>(settingsPath);

  const finalizedConstraints = useMemo(
    () =>
      emailLower
        ? [
            where('observedEmail', '==', emailLower),
            where('status', '==', OBSERVATION_STATUS.finalized),
            orderBy('finalizedAt', 'desc'),
            limit(10),
          ]
        : [],
    [emailLower],
  );
  const { data: finalizedObs } = useFirestoreCollection<Observation>(
    emailLower ? COLLECTIONS.observations : '',
    finalizedConstraints,
  );

  const { observation: wpDraft } = useActiveWorkProductObservation(emailLower);
  const { observation: irDraft } = useActiveInstructionalRoundObservation(emailLower);
  const wpQuestions = useFirestoreCollection(COLLECTIONS.workProductQuestions);
  const { hasWorkProduct, hasInstructionalRound } = useActiveObservationTypes();

  const finalizedStandard = useMemo(
    () => (finalizedObs ?? []).filter((o) => o.type === OBSERVATION_TYPES.standard),
    [finalizedObs],
  );

  const tasks = useMemo<CheckpointWithStatus[]>(() => {
    if (!staff) return [];
    return deriveCheckpoints(config?.checkpoints ?? {}, {
      finalizedStandard,
      workProductDraft: wpDraft,
      instructionalRoundDraft: irDraft,
      finalizedWorkProduct: null,
      finalizedInstructionalRound: null,
      workProductQuestionsCount: wpQuestions.data?.length ?? 0,
      instructionalRoundQuestionsCount: wpQuestions.data?.length ?? 0,
      appSettings: appSettings ?? null,
      hasWorkProduct,
      hasInstructionalRound,
    });
  }, [
    staff,
    config,
    finalizedStandard,
    wpDraft,
    irDraft,
    wpQuestions.data,
    appSettings,
    hasWorkProduct,
    hasInstructionalRound,
  ]);

  const ackMutation = useMutation({
    mutationFn: async (observationId: string) => {
      await updateDoc(doc(db, COLLECTIONS.observations, observationId), {
        acknowledgedAt: serverTimestamp(),
        acknowledgedBy: emailLower,
        lastModifiedAt: serverTimestamp(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (q) => {
          if (!Array.isArray(q.queryKey)) return false;
          const second: unknown = q.queryKey[1];
          return typeof second === 'string' && second.includes(COLLECTIONS.observations);
        },
      });
    },
  });

  if (staffLoading && !staff) {
    return (
      <div className="staff-dashboard">
        <div className="page">
          <Skeleton className="mb-6 h-[260px] w-full rounded-2xl" />
          <Skeleton className="mb-3 h-9 w-[420px]" />
          <Skeleton className="h-[160px] w-full" />
        </div>
      </div>
    );
  }

  if (!user || !staff) {
    return (
      <div className="staff-dashboard">
        <div className="page">
          <p className="empty-note">No staff record found for your account.</p>
        </div>
      </div>
    );
  }

  const peSource = wpDraft ?? irDraft ?? finalizedStandard[0] ?? null;
  const peerEvaluator: { name: string; email: string; role: string } | null = peSource
    ? {
        name: peSource.observerEmail.split('@')[0] ?? peSource.observerEmail,
        email: peSource.observerEmail,
        role: 'Peer Evaluator',
      }
    : null;

  return (
    <DashboardView
      staff={staff}
      firstName={extractFirstName(staff.name)}
      yearTierLabel={yearTierLabelFor(staff.year)}
      cycleYearLabel={currentSchoolYearLabel()}
      cycleCloseLabel="May 15"
      sections={config?.sections ?? DEFAULT_SECTIONS}
      tasks={tasks}
      quickMaterials={quick?.items ?? []}
      peerEvaluator={peerEvaluator}
      onAcknowledge={(id) => ackMutation.mutate(id)}
      acknowledging={ackMutation.isPending}
    />
  );
}

export type { CheckpointWithStatus };
```

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/dashboard/DashboardView.tsx apps/web/src/dashboard/StaffDashboardPage.tsx
```

Expected: no errors.

- [ ] **Step 4: Verify /dashboard still renders identically**

With the dev server running, visit `http://localhost:5173/dashboard`. Confirm the page looks the same as before this task — hero with progress ring, timeline (if config has it on), task cards, right rail with Quick Materials and Evaluator card. No visible regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/dashboard/
git commit -m "refactor(dashboard): extract <DashboardView> for reuse by admin preview"
```

---

### Task 4: Draft-state hook (`useDashboardDraft`)

**Files:**
- Create: `apps/web/src/admin/dashboard/useDashboardDraft.ts`

- [ ] **Step 1: Write the hook**

Create `apps/web/src/admin/dashboard/useDashboardDraft.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  type DashboardCheckpointsConfig,
  type DashboardConfig,
  type DashboardQuickMaterial,
  type DashboardQuickMaterialsDoc,
  type DashboardSectionsConfig,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { db } from '@/lib/firebase';

/**
 * Manages the local draft of the dashboard config + quick materials.
 *
 * The page binds form inputs to the draft. The Save action writes both
 * Firestore docs in a single setDoc batch. `isDirty` is true exactly when
 * the local draft diverges from the last-known saved snapshot, driving
 * the Save button's enabled state and the unsaved-changes pill.
 *
 * Initial hydration happens once per doc landing (via a ref guard) so
 * later snapshots don't clobber in-progress edits. Mirrors the
 * `useHydratedDraft` idiom but local to this hook.
 */

const DEFAULT_SECTIONS: DashboardSectionsConfig = {
  hero: true,
  timeline: true,
  filterBar: true,
  quickMaterials: true,
  peerEvaluatorCard: true,
};

export interface DashboardDraft {
  sections: DashboardSectionsConfig;
  checkpoints: DashboardCheckpointsConfig;
  quickMaterials: DashboardQuickMaterial[];
}

export interface UseDashboardDraftResult {
  draft: DashboardDraft;
  savedSnapshot: DashboardDraft | null;
  setSections: (next: DashboardSectionsConfig) => void;
  setCheckpoints: (next: DashboardCheckpointsConfig) => void;
  setQuickMaterials: (next: DashboardQuickMaterial[]) => void;
  isDirty: boolean;
  saving: boolean;
  savedAt: Date | null;
  saveError: string | null;
  save: () => Promise<void>;
  /** Discards local edits, snaps draft back to the last saved state. */
  reset: () => void;
  loading: boolean;
}

const CONFIG_PATH = `${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`;
const QUICK_PATH = `${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`;

function stripIds<T extends { id?: string } | null>(d: T): T {
  if (!d) return d;
  const { id: _id, ...rest } = d as { id?: string } & Record<string, unknown>;
  return rest as T;
}

function freshDraft(): DashboardDraft {
  return { sections: { ...DEFAULT_SECTIONS }, checkpoints: {}, quickMaterials: [] };
}

function snapshotsEqual(a: DashboardDraft, b: DashboardDraft | null): boolean {
  if (!b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useDashboardDraft(): UseDashboardDraftResult {
  const { user } = useAuth();
  const { data: configDoc, loading: configLoading } = useFirestoreDoc<DashboardConfig>(CONFIG_PATH);
  const { data: quickDoc, loading: quickLoading } =
    useFirestoreDoc<DashboardQuickMaterialsDoc>(QUICK_PATH);

  const [draft, setDraft] = useState<DashboardDraft>(freshDraft);
  const [savedSnapshot, setSavedSnapshot] = useState<DashboardDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate once both docs have responded (either exists or empty).
  useEffect(() => {
    if (hydrated) return;
    if (configLoading || quickLoading) return;
    const next: DashboardDraft = {
      sections: stripIds(configDoc)?.sections ?? { ...DEFAULT_SECTIONS },
      checkpoints: stripIds(configDoc)?.checkpoints ?? {},
      quickMaterials: stripIds(quickDoc)?.items ?? [],
    };
    setDraft(next);
    setSavedSnapshot(next);
    setHydrated(true);
  }, [hydrated, configLoading, quickLoading, configDoc, quickDoc]);

  const setSections = useCallback((next: DashboardSectionsConfig) => {
    setDraft((d) => ({ ...d, sections: next }));
  }, []);
  const setCheckpoints = useCallback((next: DashboardCheckpointsConfig) => {
    setDraft((d) => ({ ...d, checkpoints: next }));
  }, []);
  const setQuickMaterials = useCallback((next: DashboardQuickMaterial[]) => {
    setDraft((d) => ({ ...d, quickMaterials: next }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        setDoc(
          doc(db, CONFIG_PATH),
          {
            sections: draft.sections,
            checkpoints: draft.checkpoints,
            updatedAt: serverTimestamp(),
            ...(user?.email ? { updatedBy: user.email } : {}),
          },
          { merge: true },
        ),
        setDoc(
          doc(db, QUICK_PATH),
          {
            items: draft.quickMaterials,
            updatedAt: serverTimestamp(),
            ...(user?.email ? { updatedBy: user.email } : {}),
          },
          { merge: true },
        ),
      ]);
      setSavedSnapshot(draft);
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, user?.email]);

  const reset = useCallback(() => {
    if (savedSnapshot) setDraft(savedSnapshot);
  }, [savedSnapshot]);

  const isDirty = useMemo(() => !snapshotsEqual(draft, savedSnapshot), [draft, savedSnapshot]);

  return {
    draft,
    savedSnapshot,
    setSections,
    setCheckpoints,
    setQuickMaterials,
    isDirty,
    saving,
    savedAt,
    saveError,
    save,
    reset,
    loading: !hydrated,
  };
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/admin/dashboard/useDashboardDraft.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/useDashboardDraft.ts
git commit -m "feat(admin-dashboard): add useDashboardDraft hook"
```

---

### Task 5: Visual icon picker

**Files:**
- Create: `apps/web/src/admin/dashboard/IconPicker.tsx`

- [ ] **Step 1: Write the IconPicker**

Create `apps/web/src/admin/dashboard/IconPicker.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { MATERIAL_ICONS, type MaterialIcon } from '@ops/shared';
import { DashboardIcon, type DashboardIconName } from '@/dashboard/DashboardIcon';
import { cn } from '@/lib/utils';

/**
 * Visual icon picker — a popover with a grid of icon buttons. Replaces
 * the bare `<select>` of icon tokens with something a non-technical user
 * can recognize at a glance.
 *
 * The trigger button shows the currently-selected icon plus a chevron.
 * Click to open a popover anchored below the trigger; click an icon to
 * select; click outside to close.
 */

export function IconPicker({
  value,
  onChange,
}: {
  value: MaterialIcon;
  onChange: (icon: MaterialIcon) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Pick an icon"
        className={cn(
          'border-input bg-background hover:bg-accent inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm',
          'transition-colors',
        )}
      >
        <span className="text-ops-blue">
          <DashboardIcon name={value as DashboardIconName} size={18} />
        </span>
        <span className="text-muted-foreground text-xs capitalize">{value}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div className="border-border bg-popover absolute z-30 mt-1 w-64 rounded-md border p-2 shadow-lg">
          <div className="grid grid-cols-4 gap-1">
            {MATERIAL_ICONS.map((icn) => {
              const active = icn === value;
              return (
                <button
                  key={icn}
                  type="button"
                  aria-label={icn}
                  onClick={() => {
                    onChange(icn);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex h-12 flex-col items-center justify-center gap-0.5 rounded-md text-xs transition-colors',
                    active
                      ? 'bg-ops-blue text-white'
                      : 'hover:bg-accent text-foreground',
                  )}
                >
                  <DashboardIcon name={icn as DashboardIconName} size={18} />
                  <span className="text-[10px] capitalize">{icn}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/admin/dashboard/IconPicker.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/IconPicker.tsx
git commit -m "feat(admin-dashboard): visual IconPicker for quick materials"
```

---

### Task 6: Sortable wrapper for dnd-kit

**Files:**
- Create: `apps/web/src/admin/dashboard/SortableItem.tsx`

- [ ] **Step 1: Write the wrapper**

Create `apps/web/src/admin/dashboard/SortableItem.tsx`:

```tsx
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Thin render-prop wrapper around @dnd-kit/sortable's useSortable. The
 * sortable list itself (DndContext + SortableContext) lives in the
 * caller, since drag handlers depend on the caller's data shape.
 *
 * Children receive a `dragHandleProps` object — spread it on the element
 * that should be the drag handle (usually a small grip icon button), so
 * the rest of the row stays interactive (toggles, inputs, etc.).
 */

export interface SortableItemProps {
  id: string;
  children: (api: {
    isDragging: boolean;
    dragHandleProps: React.HTMLAttributes<HTMLElement>;
  }) => React.ReactNode;
  className?: string;
}

export function SortableItem({ id, children, className }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  // `attributes` are aria-* hints; `listeners` are pointer/keyboard
  // events. Both must land on the handle, not the whole row, so users
  // can still click inputs.
  const dragHandleProps: React.HTMLAttributes<HTMLElement> = {
    ...attributes,
    ...(listeners as React.HTMLAttributes<HTMLElement>),
  };
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children({ isDragging, dragHandleProps })}
    </div>
  );
}

/**
 * Standard grip handle button — spread `dragHandleProps` onto it.
 * Renders the lucide GripVertical icon at the size most rows want.
 */
export function GripHandle({
  dragHandleProps,
  label = 'Drag to reorder',
}: {
  dragHandleProps: React.HTMLAttributes<HTMLElement>;
  label?: string;
}) {
  return (
    <button
      type="button"
      {...dragHandleProps}
      aria-label={label}
      className={cn(
        'text-muted-foreground hover:bg-muted inline-flex h-9 w-9 cursor-grab items-center justify-center rounded-md',
        'active:cursor-grabbing',
      )}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/admin/dashboard/SortableItem.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/SortableItem.tsx
git commit -m "feat(admin-dashboard): SortableItem + GripHandle dnd-kit wrappers"
```

---

### Task 7: Section tiles editor

**Files:**
- Create: `apps/web/src/admin/dashboard/SectionTilesEditor.tsx`

- [ ] **Step 1: Write the editor**

Create `apps/web/src/admin/dashboard/SectionTilesEditor.tsx`:

```tsx
import { Check, X } from 'lucide-react';
import type { DashboardSectionsConfig } from '@ops/shared';
import { cn } from '@/lib/utils';
import { SECTION_COPY, ST_BLURB, ST_HEADING, ST_OFF, ST_ON } from './copyStrings';

/**
 * Visual section toggles — five tiles, one per top-level area of the
 * staff dashboard. Click a tile to flip it. The on/off state is
 * communicated by tile color + a small Check/X badge in the corner.
 */

export function SectionTilesEditor({
  value,
  onChange,
}: {
  value: DashboardSectionsConfig;
  onChange: (next: DashboardSectionsConfig) => void;
}) {
  const keys = Object.keys(SECTION_COPY) as (keyof DashboardSectionsConfig)[];

  function toggle(k: keyof DashboardSectionsConfig) {
    onChange({ ...value, [k]: !value[k] });
  }

  return (
    <section>
      <h3 className="text-foreground mb-1 text-base font-semibold">{ST_HEADING}</h3>
      <p className="text-muted-foreground mb-4 text-sm">{ST_BLURB}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map((k) => {
          const on = value[k];
          const copy = SECTION_COPY[k];
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              aria-pressed={on}
              className={cn(
                'group relative flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-all',
                on
                  ? 'border-ops-blue bg-ops-blue-lighter/40'
                  : 'border-border bg-background hover:border-ops-blue/40',
              )}
            >
              <span
                className={cn(
                  'absolute top-3 right-3 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold',
                  on
                    ? 'bg-ops-blue text-white'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {on ? (
                  <>
                    <Check className="h-3 w-3" /> {ST_ON}
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3" /> {ST_OFF}
                  </>
                )}
              </span>
              <span
                className={cn(
                  'pr-12 text-sm font-semibold',
                  on ? 'text-ops-blue-dark' : 'text-foreground',
                )}
              >
                {copy.title}
              </span>
              <span className="text-muted-foreground pr-12 text-xs leading-snug">
                {copy.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/admin/dashboard/SectionTilesEditor.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/SectionTilesEditor.tsx
git commit -m "feat(admin-dashboard): visual SectionTilesEditor"
```

---

### Task 8: Cycle steps editor (drag-and-drop)

**Files:**
- Create: `apps/web/src/admin/dashboard/CycleStepsEditor.tsx`

- [ ] **Step 1: Write the editor**

Create `apps/web/src/admin/dashboard/CycleStepsEditor.tsx`:

```tsx
import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  CHECKPOINT_TYPE_KEYS,
  type CheckpointTypeKey,
  type DashboardCheckpointConfig,
  type DashboardCheckpointsConfig,
} from '@ops/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  CHECKPOINT_COPY,
  CS_BLURB,
  CS_CUSTOMIZE_HIDE,
  CS_CUSTOMIZE_TOGGLE,
  CS_HEADING,
  CS_LABEL_CHIP,
  CS_LABEL_CTA,
  CS_LABEL_TITLE,
  CS_PLACEHOLDER_DEFAULT,
  CS_SHOW_LABEL,
} from './copyStrings';
import { GripHandle, SortableItem } from './SortableItem';

/**
 * Cycle-steps editor. Renders the 8 checkpoint types as a vertical,
 * drag-reorderable list. Each row has:
 *   - drag handle
 *   - phase chip (Schedule / Visit / Reflect / Sign-off)
 *   - plain-English title + description
 *   - a visual "Show this step to staff" switch
 *   - collapsed-by-default "Rename" expander revealing 3 label-override
 *     fields
 */

interface Row extends DashboardCheckpointConfig {
  key: CheckpointTypeKey;
}

function defaultRow(key: CheckpointTypeKey, order: number): Row {
  return {
    key,
    enabled: true,
    order,
    typeLabelOverride: '',
    titleOverride: '',
    ctaLabelOverride: '',
  };
}

function configToRows(cfg: DashboardCheckpointsConfig | undefined): Row[] {
  const safe = cfg ?? {};
  return CHECKPOINT_TYPE_KEYS.map((key, idx) => {
    const c = safe[key];
    return {
      key,
      enabled: c?.enabled ?? true,
      order: c?.order ?? idx,
      typeLabelOverride: c?.typeLabelOverride ?? '',
      titleOverride: c?.titleOverride ?? '',
      ctaLabelOverride: c?.ctaLabelOverride ?? '',
    };
  }).sort((a, b) => a.order - b.order);
}

function rowsToConfig(rows: Row[]): DashboardCheckpointsConfig {
  const out: DashboardCheckpointsConfig = {};
  rows.forEach((r, idx) => {
    out[r.key] = {
      enabled: r.enabled,
      order: idx,
      typeLabelOverride: r.typeLabelOverride.trim(),
      titleOverride: r.titleOverride.trim(),
      ctaLabelOverride: r.ctaLabelOverride.trim(),
    };
  });
  return out;
}

export function CycleStepsEditor({
  value,
  onChange,
}: {
  value: DashboardCheckpointsConfig;
  onChange: (next: DashboardCheckpointsConfig) => void;
}) {
  const rows = configToRows(value);
  const [expanded, setExpanded] = useState<Set<CheckpointTypeKey>>(new Set());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: Row[]) {
    onChange(rowsToConfig(next));
  }

  function updateRow(key: CheckpointTypeKey, patch: Partial<Row>) {
    commit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = rows.findIndex((r) => r.key === e.active.id);
    const newIndex = rows.findIndex((r) => r.key === e.over!.id);
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(rows, oldIndex, newIndex));
  }

  function toggleExpand(key: CheckpointTypeKey) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section>
      <h3 className="text-foreground mb-1 text-base font-semibold">{CS_HEADING}</h3>
      <p className="text-muted-foreground mb-4 text-sm">{CS_BLURB}</p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={rows.map((r) => r.key)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {rows.map((r) => {
              const copy = CHECKPOINT_COPY[r.key];
              const isExpanded = expanded.has(r.key);
              return (
                <SortableItem key={r.key} id={r.key}>
                  {({ dragHandleProps }) => (
                    <li className="border-border bg-background rounded-lg border">
                      <div className="flex items-start gap-2 p-3">
                        <GripHandle dragHandleProps={dragHandleProps} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <PhaseChip phase={copy.phase} />
                            <span
                              className={cn(
                                'text-sm font-semibold',
                                r.enabled ? 'text-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {copy.title}
                            </span>
                          </div>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            <strong className="text-foreground font-medium">When it shows:</strong>{' '}
                            {copy.whenItShows}
                          </p>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            <strong className="text-foreground font-medium">
                              What staff see:
                            </strong>{' '}
                            {copy.whatItDoes}
                          </p>
                          <button
                            type="button"
                            onClick={() => toggleExpand(r.key)}
                            className="text-ops-blue hover:bg-ops-blue-lighter/40 mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
                          >
                            {isExpanded ? CS_CUSTOMIZE_HIDE : CS_CUSTOMIZE_TOGGLE}
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                        <ShowSwitch
                          on={r.enabled}
                          onChange={() => updateRow(r.key, { enabled: !r.enabled })}
                        />
                      </div>
                      {isExpanded ? (
                        <div className="bg-muted/30 grid gap-3 px-3 pb-3 md:grid-cols-3">
                          <LabelField
                            label={CS_LABEL_CHIP}
                            value={r.typeLabelOverride}
                            onChange={(v) => updateRow(r.key, { typeLabelOverride: v })}
                          />
                          <LabelField
                            label={CS_LABEL_TITLE}
                            value={r.titleOverride}
                            onChange={(v) => updateRow(r.key, { titleOverride: v })}
                          />
                          <LabelField
                            label={CS_LABEL_CTA}
                            value={r.ctaLabelOverride}
                            onChange={(v) => updateRow(r.key, { ctaLabelOverride: v })}
                          />
                        </div>
                      ) : null}
                    </li>
                  )}
                </SortableItem>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function PhaseChip({ phase }: { phase: 'Schedule' | 'Visit' | 'Reflect' | 'Sign-off' }) {
  const palette: Record<typeof phase, string> = {
    Schedule: 'bg-blue-100 text-blue-800',
    Visit: 'bg-emerald-100 text-emerald-800',
    Reflect: 'bg-amber-100 text-amber-800',
    'Sign-off': 'bg-red-100 text-red-800',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase',
        palette[phase],
      )}
    >
      {phase}
    </span>
  );
}

function ShowSwitch({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={CS_SHOW_LABEL}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        on ? 'bg-ops-blue' : 'bg-gray-300',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function LabelField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={CS_PLACEHOLDER_DEFAULT}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/admin/dashboard/CycleStepsEditor.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/CycleStepsEditor.tsx
git commit -m "feat(admin-dashboard): drag-and-drop CycleStepsEditor with plain-English copy"
```

---

### Task 9: Quick materials editor (card-based, drag-and-drop)

**Files:**
- Create: `apps/web/src/admin/dashboard/QuickMaterialsEditor.tsx`

- [ ] **Step 1: Write the editor**

Create `apps/web/src/admin/dashboard/QuickMaterialsEditor.tsx`:

```tsx
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import {
  type DashboardQuickMaterial,
  type MaterialIcon,
} from '@ops/shared';
import { DashboardIcon } from '@/dashboard/DashboardIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { GripHandle, SortableItem } from './SortableItem';
import { IconPicker } from './IconPicker';
import {
  QM_ADD,
  QM_BLURB,
  QM_EMPTY,
  QM_FIELD_SUBTITLE,
  QM_FIELD_TITLE,
  QM_FIELD_URL,
  QM_HEADING,
  QM_ICON_PICKER,
  QM_REMOVE,
} from './copyStrings';

/**
 * Quick materials editor — drag-reorderable list of cards, each showing
 * a full preview of the rendered chip a staff member sees, alongside the
 * input fields. The icon picker is visual (see IconPicker.tsx).
 *
 * Items are tracked by their array index; cards carry a stable
 * client-side id so dnd-kit and React reconcilation behave correctly
 * during reorder. (The id is local to this component — it never goes to
 * Firestore; the persisted list is an array, position = order.)
 */

interface Item extends DashboardQuickMaterial {
  /** Local-only stable id for sortable + key, derived once on mount. */
  _id: string;
}

function withIds(items: DashboardQuickMaterial[]): Item[] {
  return items.map((m, i) => ({ ...m, _id: `m-${String(i)}-${String(Date.now())}-${String(Math.random())}` }));
}

function stripIds(items: Item[]): DashboardQuickMaterial[] {
  return items.map(({ _id, ...rest }) => rest);
}

export function QuickMaterialsEditor({
  value,
  onChange,
}: {
  value: DashboardQuickMaterial[];
  onChange: (next: DashboardQuickMaterial[]) => void;
}) {
  // Rebuild ids each render is fine — they only need to be stable
  // within a single render pass for dnd-kit's drag identity, and we
  // reorder via arrayMove so the underlying array reference changes
  // when needed.
  const items: Item[] = withIds(value);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function commit(next: Item[]) {
    onChange(stripIds(next));
  }
  function update(idx: number, patch: Partial<DashboardQuickMaterial>) {
    commit(items.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }
  function add() {
    commit([
      ...items,
      { _id: `new-${String(Date.now())}`, label: '', sub: '', icon: 'doc', url: '' },
    ]);
  }
  function remove(idx: number) {
    commit(items.filter((_, i) => i !== idx));
  }
  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = items.findIndex((m) => m._id === e.active.id);
    const newIndex = items.findIndex((m) => m._id === e.over!.id);
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <section>
      <h3 className="text-foreground mb-1 text-base font-semibold">{QM_HEADING}</h3>
      <p className="text-muted-foreground mb-4 text-sm">{QM_BLURB}</p>

      {items.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center text-sm">
          {QM_EMPTY}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={items.map((m) => m._id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-3">
              {items.map((m, idx) => (
                <SortableItem key={m._id} id={m._id}>
                  {({ dragHandleProps }) => (
                    <li className="border-border bg-background rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        <GripHandle dragHandleProps={dragHandleProps} />
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="grid gap-3 md:grid-cols-[140px_1fr_1fr]">
                            <div className="grid gap-1">
                              <Label className="text-xs">{QM_ICON_PICKER}</Label>
                              <IconPicker
                                value={m.icon}
                                onChange={(icon: MaterialIcon) => update(idx, { icon })}
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label className="text-xs">{QM_FIELD_TITLE}</Label>
                              <Input
                                value={m.label}
                                onChange={(e) => update(idx, { label: e.target.value })}
                                placeholder="My rubric"
                              />
                            </div>
                            <div className="grid gap-1">
                              <Label className="text-xs">{QM_FIELD_SUBTITLE}</Label>
                              <Input
                                value={m.sub}
                                onChange={(e) => update(idx, { sub: e.target.value })}
                                placeholder="Domains 2 & 3 · 14 components"
                              />
                            </div>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs">{QM_FIELD_URL}</Label>
                            <Input
                              value={m.url}
                              onChange={(e) => update(idx, { url: e.target.value })}
                              placeholder="https://drive.google.com/…"
                            />
                          </div>
                          <ChipPreview item={m} />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={QM_REMOVE}
                          onClick={() => remove(idx)}
                        >
                          <Trash2 className="text-destructive h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  )}
                </SortableItem>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <Button type="button" variant="outline" onClick={add} className="mt-3">
        <Plus className="mr-1.5 h-4 w-4" />
        {QM_ADD}
      </Button>
    </section>
  );
}

function ChipPreview({ item }: { item: DashboardQuickMaterial }) {
  const empty = !item.label && !item.url;
  return (
    <div
      className={cn(
        'border-border bg-muted/30 grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-md border-l-2 px-3 py-2',
        'border-l-ops-blue',
      )}
    >
      <div className="bg-ops-blue-lighter text-ops-blue flex h-8 w-8 items-center justify-center rounded">
        <DashboardIcon name={item.icon} size={16} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {empty ? 'Card preview' : item.label || '(no title)'}
        </div>
        {item.sub ? <div className="text-muted-foreground truncate text-xs">{item.sub}</div> : null}
      </div>
      {item.url ? <ExternalLink className="text-muted-foreground h-4 w-4" /> : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/admin/dashboard/QuickMaterialsEditor.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/QuickMaterialsEditor.tsx
git commit -m "feat(admin-dashboard): card-based QuickMaterialsEditor with icon picker + DnD"
```

---

### Task 10: Live preview pane

**Files:**
- Create: `apps/web/src/admin/dashboard/DashboardPreview.tsx`

- [ ] **Step 1: Write the preview**

Create `apps/web/src/admin/dashboard/DashboardPreview.tsx`:

```tsx
import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  type AppSettings,
  type DashboardCheckpointsConfig,
  type DashboardQuickMaterial,
  type DashboardSectionsConfig,
  type Observation,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';
import { DashboardView } from '@/dashboard/DashboardView';
import { deriveCheckpoints, extractFirstName } from '@/dashboard/deriveCheckpoints';
import { Eye } from 'lucide-react';

/**
 * Right-column live preview. Renders <DashboardView> with the admin's
 * *draft* sections/checkpoints/quick-materials — so every edit shows up
 * immediately, before the admin clicks Save.
 *
 * Real observation data + staff doc still come from Firestore so the
 * preview reflects the admin's own dashboard state. Read-only (no
 * Acknowledge button, no outbound email links).
 */

function yearTierLabelFor(year: number): string {
  if (year >= 4) return `Probationary Y${String(year - 3)}`;
  return `Year ${String(year)}`;
}

function currentSchoolYearLabel(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 7 ? year : year - 1;
  return `${String(startYear)} — ${String(startYear + 1)}`;
}

export interface DashboardPreviewProps {
  sections: DashboardSectionsConfig;
  checkpoints: DashboardCheckpointsConfig;
  quickMaterials: DashboardQuickMaterial[];
}

export function DashboardPreview({
  sections,
  checkpoints,
  quickMaterials,
}: DashboardPreviewProps) {
  const { user } = useAuth();
  const emailLower = user?.email?.toLowerCase() ?? '';

  const staffPath = emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '';
  const { data: staff } = useFirestoreDoc<Staff>(staffPath);
  const settingsPath = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;
  const { data: appSettings } = useFirestoreDoc<AppSettings>(settingsPath);

  const finalizedConstraints = useMemo(
    () =>
      emailLower
        ? [
            where('observedEmail', '==', emailLower),
            where('status', '==', OBSERVATION_STATUS.finalized),
            orderBy('finalizedAt', 'desc'),
            limit(10),
          ]
        : [],
    [emailLower],
  );
  const { data: finalizedObs } = useFirestoreCollection<Observation>(
    emailLower ? COLLECTIONS.observations : '',
    finalizedConstraints,
  );
  const { observation: wpDraft } = useActiveWorkProductObservation(emailLower);
  const { observation: irDraft } = useActiveInstructionalRoundObservation(emailLower);
  const wpQuestions = useFirestoreCollection(COLLECTIONS.workProductQuestions);
  const { hasWorkProduct, hasInstructionalRound } = useActiveObservationTypes();

  const finalizedStandard = useMemo(
    () => (finalizedObs ?? []).filter((o) => o.type === OBSERVATION_TYPES.standard),
    [finalizedObs],
  );

  const tasks = useMemo(() => {
    if (!staff) return [];
    return deriveCheckpoints(checkpoints, {
      finalizedStandard,
      workProductDraft: wpDraft,
      instructionalRoundDraft: irDraft,
      finalizedWorkProduct: null,
      finalizedInstructionalRound: null,
      workProductQuestionsCount: wpQuestions.data?.length ?? 0,
      instructionalRoundQuestionsCount: wpQuestions.data?.length ?? 0,
      appSettings: appSettings ?? null,
      hasWorkProduct,
      hasInstructionalRound,
    });
  }, [
    staff,
    checkpoints,
    finalizedStandard,
    wpDraft,
    irDraft,
    wpQuestions.data,
    appSettings,
    hasWorkProduct,
    hasInstructionalRound,
  ]);

  if (!staff) {
    return (
      <div className="border-border bg-muted/20 flex h-full items-center justify-center rounded-lg border p-8 text-sm">
        Loading preview…
      </div>
    );
  }

  const peSource = wpDraft ?? irDraft ?? finalizedStandard[0] ?? null;
  const peerEvaluator = peSource
    ? {
        name: peSource.observerEmail.split('@')[0] ?? peSource.observerEmail,
        email: peSource.observerEmail,
        role: 'Peer Evaluator',
      }
    : null;

  return (
    <div className="border-border bg-background flex h-full flex-col overflow-hidden rounded-lg border">
      <div className="bg-ops-blue-lighter/50 border-border flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold">
        <Eye className="text-ops-blue h-4 w-4" />
        <span className="text-ops-blue-dark">Preview — what staff see</span>
        <span className="text-muted-foreground ml-auto font-normal">
          Live, with your unsaved edits
        </span>
      </div>
      <div className="origin-top-left flex-1 overflow-auto">
        <div style={{ transform: 'scale(0.75)', transformOrigin: 'top left', width: '133.33%' }}>
          <DashboardView
            staff={staff}
            firstName={extractFirstName(staff.name)}
            yearTierLabel={yearTierLabelFor(staff.year)}
            cycleYearLabel={currentSchoolYearLabel()}
            cycleCloseLabel="May 15"
            sections={sections}
            tasks={tasks}
            quickMaterials={quickMaterials}
            peerEvaluator={peerEvaluator}
            readOnly
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/admin/dashboard/DashboardPreview.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/admin/dashboard/DashboardPreview.tsx
git commit -m "feat(admin-dashboard): live DashboardPreview pane (scaled, read-only)"
```

---

### Task 11: Rebuild `DashboardSettingsPage`

**Files:**
- Modify: `apps/web/src/admin/dashboard/DashboardSettingsPage.tsx` (full replace)

- [ ] **Step 1: Replace the page**

Overwrite `apps/web/src/admin/dashboard/DashboardSettingsPage.tsx` with:

```tsx
import { useState } from 'react';
import { AlertCircle, Check, Eye, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { CycleStepsEditor } from './CycleStepsEditor';
import { DashboardPreview } from './DashboardPreview';
import { QuickMaterialsEditor } from './QuickMaterialsEditor';
import { SectionTilesEditor } from './SectionTilesEditor';
import { useDashboardDraft } from './useDashboardDraft';
import {
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SAVE_BUTTON_DEFAULT,
  SAVE_BUTTON_DIRTY,
  SAVE_BUTTON_SAVING,
  TABS,
  UNSAVED_PILL,
  type TabKey,
} from './copyStrings';

/**
 * /admin/dashboard — the redesigned config surface.
 *
 * Layout:
 *   - Sticky chrome: tabs on the left, Save / Discard / unsaved-pill on
 *     the right.
 *   - Two-column body: tab content (60%), live preview (40%).
 *   - Single source of draft state via useDashboardDraft; one Save
 *     action persists everything.
 *
 * Mobile (< lg): preview collapses behind a toggle so the editor gets
 * the full width.
 */

export function DashboardSettingsPage() {
  const draft = useDashboardDraft();
  const [tab, setTab] = useState<TabKey>('layout');
  const [showPreviewMobile, setShowPreviewMobile] = useState(false);

  const saveLabel = draft.saving
    ? SAVE_BUTTON_SAVING
    : draft.isDirty
      ? SAVE_BUTTON_DIRTY
      : SAVE_BUTTON_DEFAULT;

  return (
    <PageHeader title={PAGE_TITLE} subtitle={PAGE_SUBTITLE}>
      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b bg-white/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
        <TabButton active={tab === 'layout'} onClick={() => setTab('layout')}>
          {TABS.layout}
        </TabButton>
        <TabButton active={tab === 'steps'} onClick={() => setTab('steps')}>
          {TABS.steps}
        </TabButton>
        <TabButton active={tab === 'materials'} onClick={() => setTab('materials')}>
          {TABS.materials}
        </TabButton>
        <div className="ml-auto flex items-center gap-3">
          {draft.isDirty ? (
            <span className="bg-amber-100 text-amber-800 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
              <AlertCircle className="h-3 w-3" />
              {UNSAVED_PILL}
            </span>
          ) : draft.savedAt ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Check className="h-3 w-3 text-green-600" />
              Saved at {draft.savedAt.toLocaleTimeString()}
            </span>
          ) : null}
          {draft.isDirty ? (
            <Button variant="ghost" size="sm" onClick={draft.reset}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Discard
            </Button>
          ) : null}
          <Button
            onClick={() => void draft.save()}
            disabled={!draft.isDirty || draft.saving}
            size="sm"
          >
            {saveLabel}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreviewMobile((v) => !v)}
            className="lg:hidden"
            aria-label="Toggle preview"
          >
            <Eye className="mr-1 h-3.5 w-3.5" />
            {showPreviewMobile ? 'Hide preview' : 'Show preview'}
          </Button>
        </div>
      </div>

      {draft.saveError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-2 text-sm">
          {draft.saveError}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className={cn(showPreviewMobile && 'hidden lg:block')}>
          {tab === 'layout' ? (
            <SectionTilesEditor value={draft.draft.sections} onChange={draft.setSections} />
          ) : null}
          {tab === 'steps' ? (
            <CycleStepsEditor
              value={draft.draft.checkpoints}
              onChange={draft.setCheckpoints}
            />
          ) : null}
          {tab === 'materials' ? (
            <QuickMaterialsEditor
              value={draft.draft.quickMaterials}
              onChange={draft.setQuickMaterials}
            />
          ) : null}
        </div>
        <div className={cn(!showPreviewMobile && 'hidden lg:block', 'lg:sticky lg:top-24 lg:h-[calc(100vh-160px)]')}>
          <DashboardPreview
            sections={draft.draft.sections}
            checkpoints={draft.draft.checkpoints}
            quickMaterials={draft.draft.quickMaterials}
          />
        </div>
      </div>
    </PageHeader>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-ops-blue text-white'
          : 'text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm --filter @ops/web typecheck
npx eslint --fix apps/web/src/admin/dashboard/DashboardSettingsPage.tsx
```

Expected: no errors.

- [ ] **Step 3: Verify in the running preview**

With the dev server running, visit `http://localhost:5173/admin/dashboard`. Confirm:

1. The page loads without RouteErrorBoundary errors (check `preview_console_logs`).
2. Three tab buttons appear: Layout, Cycle steps, Quick materials.
3. The right column shows a "Preview — what staff see" pane with the scaled-down dashboard.
4. **Layout tab:** five section tiles render. Clicking one flips the on/off badge and the corresponding section appears/disappears in the preview pane.
5. **Cycle steps tab:** 8 rows with drag handles, phase chips, plain-English descriptions, and on/off switches. Dragging changes order; clicking "Rename" reveals 3 override fields.
6. **Quick materials tab:** existing materials load with icon, title, subtitle, URL inputs and a chip preview below each row. Clicking the icon button opens a visual icon grid.
7. The header bar shows "Unsaved changes" pill when any field is changed, and the Save button is enabled.
8. Clicking Save persists both docs; on success the pill disappears and "Saved at …" replaces it.
9. Clicking Discard reverts all unsaved edits.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/admin/dashboard/DashboardSettingsPage.tsx
git commit -m "feat(admin-dashboard): redesigned page — tabs, single save, live preview"
```

---

### Task 12: End-to-end verification + final lint

**Files:** (no edits unless cleanup needed)

- [ ] **Step 1: Run the full validate pipeline**

```bash
pnpm validate
```

Expected: typecheck passes, lint has 0 errors (existing CRLF warnings are fine), prettier check passes, tests pass.

- [ ] **Step 2: Manual smoke through the full flow**

In a fresh browser tab:

1. Visit `/dashboard` — confirm it still renders identically to before this rewrite.
2. Visit `/admin/dashboard` — confirm the new UI loads.
3. **Layout flow:** turn off Welcome banner → preview pane updates immediately. Click Save. Reload page. Setting persists.
4. **Cycle steps flow:** drag Acknowledge above Post-observation conversation. Save. Visit `/dashboard` — task order matches.
5. **Quick materials flow:** click Add link, pick the "rubric" icon, type a title and URL, save. Visit `/dashboard` — the new chip appears in the right rail.
6. **Discard flow:** make a change, click Discard → fields snap back, pill disappears.
7. **Unsaved warning:** make a change, navigate away via the sidebar — currently no warning (acceptable for v1). Click around to confirm no error boundaries trigger.

- [ ] **Step 3: Push**

```bash
git push origin dev-paul
```

Expected: 11 commits land on dev-paul; CI runs.

---

## Self-Review Notes

- **Spec coverage:** Every pain point from the brainstorming (jargon, 3 save buttons, no preview, flat list + unlabeled inputs) maps to specific tasks: copy strings (Task 2), single-save useDashboardDraft (Task 4), DashboardPreview (Task 10), SectionTilesEditor / CycleStepsEditor / QuickMaterialsEditor (Tasks 7–9). Drag-and-drop (Tasks 6, 8, 9). Visual icon picker (Task 5). Side-by-side preview pane (Task 10).
- **Placeholders:** scanned — no TBDs, no "similar to Task N", no unspecified error handling. Every code step shows the actual code.
- **Type consistency:** `DashboardView` props match what `StaffDashboardPage` and `DashboardPreview` pass. `useDashboardDraft.DashboardDraft` matches the props of all three editor children. `CheckpointTypeKey` / `DashboardCheckpointsConfig` / `DashboardQuickMaterial` flow from `@ops/shared` unchanged. The phase strings in `CHECKPOINT_COPY` (`'Schedule'`, `'Visit'`, `'Reflect'`, `'Sign-off'`) are used as keys in `PHASE_DESCRIPTION` and the `palette` map in `PhaseChip` — verified to be the same literal set.
- **Risk note:** `withIds` in `QuickMaterialsEditor` regenerates `_id` values on every render. Acceptable because dnd-kit only needs identity stability within a render pass (it tracks active drag via the sensor's pointer state, not via the id across renders), but if a re-key bug shows up we can stabilize ids in state.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-19-admin-dashboard-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
