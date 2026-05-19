import { useMemo, useState } from 'react';
import {
  COLLECTIONS,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  type DashboardProgress,
  type DashboardQuickMaterial,
  type DashboardQuickMaterialsDoc,
  type DashboardTemplate,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { Skeleton } from '@/components/Skeleton';
import { DashboardIcon } from './DashboardIcon';
import {
  type CheckpointStatus,
  type CheckpointWithStatus,
  decorateCheckpoints,
  initialsFromName,
  tierForYear,
} from './dashboardStatus';
import './dashboard.css';

type FilterKey = 'all' | 'active' | 'upcoming' | 'completed';

interface DashboardData {
  staff: Staff | null;
  template: DashboardTemplate | null;
  progress: DashboardProgress | null;
  quickMaterials: DashboardQuickMaterial[];
  loading: boolean;
  error: Error | null;
}

function useDashboardData(emailLower: string): DashboardData {
  const staffPath = emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '';
  const {
    data: staff,
    loading: staffLoading,
    error: staffError,
  } = useFirestoreDoc<Staff>(staffPath);

  const tier = staff ? tierForYear(staff.year) : null;
  const templatePath = tier ? `${COLLECTIONS.dashboardTemplates}/${tier}` : '';
  const { data: template, loading: templateLoading } =
    useFirestoreDoc<DashboardTemplate>(templatePath);

  const progressPath = emailLower ? `${COLLECTIONS.dashboardProgress}/${emailLower}` : '';
  const { data: progress } = useFirestoreDoc<DashboardProgress>(progressPath);

  const quickPath = `${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`;
  const { data: quick } = useFirestoreDoc<DashboardQuickMaterialsDoc>(quickPath);

  return {
    staff,
    template,
    progress,
    quickMaterials: quick?.items ?? [],
    loading: staffLoading || (tier !== null && templateLoading),
    error: staffError,
  };
}

// ─── ProgressRing ────────────────────────────────────────────────────────────
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

// ─── Hero ────────────────────────────────────────────────────────────────────
interface HeroProps {
  firstName: string;
  template: DashboardTemplate;
  tasks: CheckpointWithStatus[];
  cycleYearLabel: string;
}
function Hero({ firstName, template, tasks, cycleYearLabel }: HeroProps) {
  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const next = tasks.find((t) => t.status === 'inprogress' || t.status === 'soon');

  return (
    <section className="dash-hero">
      <div className="dash-hero__top">
        <div className="dash-hero__copy">
          <span className="dash-hero__eyebrow">{template.cycleLabel}</span>
          <h1 className="dash-hero__title">Welcome back, {firstName}.</h1>
          <p className="dash-hero__lead">
            {next ? (
              <>
                {done} of {total} checkpoints done. Next up:{' '}
                <strong style={{ color: 'var(--ot-blue-dark)' }}>{next.title.toLowerCase()}</strong>
                .
              </>
            ) : total > 0 ? (
              <>Cycle complete — nice work, {firstName}.</>
            ) : (
              <>Your cycle hasn’t been set up yet.</>
            )}
          </p>
          <div className="dash-hero__meta">
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{template.yearTierLabel}</span>
              <span className="dash-hero__meta-label">
                {template.summativeYear ? 'Summative' : 'Formative'}
              </span>
            </div>
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{template.observationsPerYear}</span>
              <span className="dash-hero__meta-label">Observations / yr</span>
            </div>
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{template.cycleCloseLabel}</span>
              <span className="dash-hero__meta-label">Cycle close</span>
            </div>
          </div>
        </div>
        <ProgressRing value={done} total={Math.max(total, 1)} />
      </div>
      <Timeline tasks={tasks} cycleYearLabel={cycleYearLabel} />
    </section>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────
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
          const left = total > 0 ? ((i + 0.5) / total) * 100 : 0;
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
              <span className="timeline__dot-date">{t.monthLabel}</span>
              <div className="timeline__dot-pin" />
              {isCurrent ? <span className="timeline__dot-label">{t.dateLabel}</span> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Filter bar ──────────────────────────────────────────────────────────────
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

// ─── Task card ───────────────────────────────────────────────────────────────
function TaskMaterials({ items }: { items: CheckpointWithStatus['materials'] }) {
  if (!items.length) return null;
  return (
    <div className="task__materials">
      {items.map((m, i) => {
        const Tag = m.url ? 'a' : 'span';
        return (
          <Tag
            key={`${m.label}-${String(i)}`}
            className="task__material"
            {...(m.url ? { href: m.url, target: '_blank', rel: 'noreferrer' } : {})}
          >
            <DashboardIcon name={m.icon} size={13} />
            <span>{m.label}</span>
          </Tag>
        );
      })}
    </div>
  );
}

function TaskCard({ task, featured }: { task: CheckpointWithStatus; featured?: boolean }) {
  const statusClass = `is-${task.status}`;
  const typeClass = `task__type-chip--${task.type}`;
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
        <TaskMaterials items={task.materials} />
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
          task.ctaUrl ? (
            <a
              href={task.ctaUrl}
              target="_blank"
              rel="noreferrer"
              className={`ot-btn ${featured ? 'ot-btn--primary' : 'ot-btn--secondary'} ot-btn--sm task__cta`}
            >
              {task.cta}
              <DashboardIcon name="arrow-right" size={12} />
            </a>
          ) : (
            <button
              type="button"
              className={`ot-btn ${featured ? 'ot-btn--primary' : 'ot-btn--secondary'} ot-btn--sm task__cta`}
            >
              {task.cta}
              <DashboardIcon name="arrow-right" size={12} />
            </button>
          )
        ) : (
          <button type="button" className="ot-btn ot-btn--tertiary ot-btn--sm">
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

// ─── Task groups ─────────────────────────────────────────────────────────────
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

// ─── Right column: evaluator + quick materials ───────────────────────────────
function EvaluatorCard({ pe }: { pe: DashboardProgress['peerEvaluator'] }) {
  const hasContact = pe.email || pe.phone;
  return (
    <div className="side-card">
      <div className="side-card__eyebrow">Your peer evaluator</div>
      {pe.name ? (
        <>
          <div className="evaluator">
            <div className="evaluator__avatar">{initialsFromName(pe.name, pe.email)}</div>
            <div>
              <h3 className="evaluator__name">{pe.name}</h3>
              {pe.role ? <p className="evaluator__role">{pe.role}</p> : null}
            </div>
          </div>
          <div className="evaluator__contacts">
            {pe.email ? (
              <div className="evaluator__row">
                <DashboardIcon name="mail" size={14} />
                <a href={`mailto:${pe.email}`}>{pe.email}</a>
              </div>
            ) : null}
            {pe.phone ? (
              <div className="evaluator__row">
                <DashboardIcon name="phone" size={14} />
                <span>{pe.phone}</span>
              </div>
            ) : null}
            {pe.hours ? (
              <div className="evaluator__row">
                <DashboardIcon name="clock" size={14} />
                <span>{pe.hours}</span>
              </div>
            ) : null}
          </div>
          {hasContact ? (
            <a
              href={pe.email ? `mailto:${pe.email}` : undefined}
              className="ot-btn ot-btn--primary ot-btn--sm"
              style={{ width: '100%' }}
            >
              Send a message
            </a>
          ) : null}
        </>
      ) : (
        <p className="empty-note">
          You don’t have a peer evaluator assigned yet. An admin will set this up.
        </p>
      )}
    </div>
  );
}

function QuickMaterials({ items }: { items: DashboardQuickMaterial[] }) {
  return (
    <div className="side-card">
      <div className="side-card__eyebrow">Quick materials</div>
      {items.length === 0 ? (
        <p className="empty-note">No materials posted yet.</p>
      ) : (
        <div className="material-list">
          {items.map((m, i) => {
            const Tag = m.url ? 'a' : 'span';
            return (
              <Tag
                key={`${m.label}-${String(i)}`}
                className="material-list__item"
                {...(m.url ? { href: m.url, target: '_blank', rel: 'noreferrer' } : {})}
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

// ─── Page root ───────────────────────────────────────────────────────────────
export function StaffDashboardPage() {
  const { user } = useAuth();
  const emailLower = user?.email?.toLowerCase() ?? '';
  const data = useDashboardData(emailLower);
  const [filter, setFilter] = useState<FilterKey>('all');

  const tasks = useMemo<CheckpointWithStatus[]>(() => {
    if (!data.template) return [];
    return decorateCheckpoints(data.template.checkpoints, data.progress);
  }, [data.template, data.progress]);

  if (data.loading && !data.template) {
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

  if (!user || !data.staff) {
    return (
      <div className="staff-dashboard">
        <div className="page">
          <p className="empty-note">No staff record found for your account.</p>
        </div>
      </div>
    );
  }

  if (!data.template) {
    return (
      <div className="staff-dashboard">
        <div className="page">
          <p className="empty-note">
            Your dashboard hasn’t been set up yet. A peer evaluator or admin needs to publish a
            checkpoint template for your year tier.
          </p>
        </div>
      </div>
    );
  }

  const completed = tasks.filter((t) => t.status === 'done');
  const active = tasks.filter((t) => t.status === 'inprogress' || t.status === 'soon');
  const upcoming = tasks.filter((t) => t.status === 'upcoming');
  const featured = active[0] ?? upcoming[0] ?? null;
  const restActive = featured && active.includes(featured) ? active.slice(1) : active;
  const restUpcoming = upcoming.filter((t) => t !== featured);

  const counts: Counts = {
    total: tasks.length,
    done: completed.length,
    active: active.length,
    upcoming: upcoming.length,
  };

  const firstName = extractFirstName(data.staff.name);
  const cycleYearLabel = currentSchoolYearLabel();
  const peerEvaluator = data.progress?.peerEvaluator ?? {
    name: '',
    email: '',
    role: '',
    phone: '',
    hours: '',
  };

  return (
    <div className="staff-dashboard">
      <div className="page">
        <Hero
          firstName={firstName}
          template={data.template}
          tasks={tasks}
          cycleYearLabel={cycleYearLabel}
        />
        <FilterBar filter={filter} setFilter={setFilter} counts={counts} />

        <div className="page-grid" style={{ marginTop: 20 }}>
          <div>
            {filter === 'all' ? (
              <>
                {featured ? (
                  <section style={{ marginBottom: 8 }}>
                    <TaskCard task={featured} featured />
                  </section>
                ) : null}
                {restActive.length > 0 ? (
                  <TaskGroup title="In progress" count={restActive.length}>
                    {restActive.map((t) => (
                      <TaskCard key={t.id} task={t} />
                    ))}
                  </TaskGroup>
                ) : null}
                <TaskGroup title="Upcoming" count={restUpcoming.length}>
                  {restUpcoming.length > 0 ? (
                    restUpcoming.map((t) => <TaskCard key={t.id} task={t} />)
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
                  active.map((t) => <TaskCard key={t.id} task={t} />)
                ) : (
                  <p className="empty-note">Nothing active right now.</p>
                )}
              </TaskGroup>
            ) : null}

            {filter === 'upcoming' ? (
              <TaskGroup title="Upcoming" count={upcoming.length}>
                {upcoming.length > 0 ? (
                  upcoming.map((t) => <TaskCard key={t.id} task={t} />)
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
            <QuickMaterials items={data.quickMaterials} />
            <EvaluatorCard pe={peerEvaluator} />
          </aside>
        </div>
      </div>
    </div>
  );
}

// Handle both "First Last" and "Last, First" formats — the imported staff
// directory uses the latter (e.g. "Ivers, Paul"), but auth display names
// use the former. Returning the staff record's full name as a fallback so
// the greeting never reads blank.
function extractFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  if (trimmed.includes(',')) {
    const afterComma = trimmed.split(',')[1]?.trim();
    if (afterComma) return afterComma.split(/\s+/)[0] ?? afterComma;
  }
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

// School-year label: runs Aug → July, so anything before Aug uses the prior
// Sept→May pair. Mirrors how the rest of the system thinks about cycles.
function currentSchoolYearLabel(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  // Aug (7) and later = current academic year starts now; before that = prior
  const startYear = month >= 7 ? year : year - 1;
  return `${String(startYear)} — ${String(startYear + 1)}`;
}

// Keep the status type exported for tests / callers; the union value
// itself is implementation-internal to the dashboard module.
export type { CheckpointStatus };
