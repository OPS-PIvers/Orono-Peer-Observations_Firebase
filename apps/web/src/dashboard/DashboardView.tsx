import { useState } from 'react';
import { type DashboardQuickMaterial, type DashboardSectionsConfig, type Staff } from '@ops/shared';
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
                      {...(props.onAcknowledge ? { onAcknowledge: props.onAcknowledge } : {})}
                      {...(props.acknowledging !== undefined
                        ? { acknowledging: props.acknowledging }
                        : {})}
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
                        {...(props.onAcknowledge ? { onAcknowledge: props.onAcknowledge } : {})}
                        {...(props.acknowledging !== undefined
                          ? { acknowledging: props.acknowledging }
                          : {})}
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
                      {...(props.onAcknowledge ? { onAcknowledge: props.onAcknowledge } : {})}
                      {...(props.acknowledging !== undefined
                        ? { acknowledging: props.acknowledging }
                        : {})}
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
                {...(m.url && !readOnly
                  ? { href: m.url, target: '_blank', rel: 'noreferrer' }
                  : {})}
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
