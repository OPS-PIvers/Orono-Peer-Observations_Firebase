import { useMemo, useState } from 'react';
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
import { DashboardIcon } from './DashboardIcon';
import {
  type CheckpointStatus,
  type CheckpointWithStatus,
  deriveCheckpoints,
  extractFirstName,
  initialsFromName,
} from './deriveCheckpoints';
import './dashboard.css';

type FilterKey = 'all' | 'active' | 'upcoming' | 'completed';

const DEFAULT_SECTIONS = {
  hero: true,
  timeline: true,
  filterBar: true,
  quickMaterials: true,
  peerEvaluatorCard: true,
};

// ─── Data layer ──────────────────────────────────────────────────────────────

interface DashboardData {
  staff: Staff | null;
  config: DashboardConfig | null;
  quickMaterials: DashboardQuickMaterial[];
  appSettings: AppSettings | null;
  finalizedStandard: Observation[];
  workProductDraft: Observation | null;
  instructionalRoundDraft: Observation | null;
  workProductQuestionsCount: number;
  instructionalRoundQuestionsCount: number;
  hasWorkProduct: boolean;
  hasInstructionalRound: boolean;
  loading: boolean;
}

function useDashboardData(emailLower: string): DashboardData {
  // Per-staff lookups
  const staffPath = emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '';
  const { data: staff, loading: staffLoading } = useFirestoreDoc<Staff>(staffPath);

  // App-wide config
  const configPath = `${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`;
  const { data: config } = useFirestoreDoc<DashboardConfig>(configPath);

  const quickPath = `${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`;
  const { data: quick } = useFirestoreDoc<DashboardQuickMaterialsDoc>(quickPath);

  const settingsPath = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;
  const { data: appSettings } = useFirestoreDoc<AppSettings>(settingsPath);

  // Observations: finalized (any type), ordered by finalizedAt desc.
  // Rules allow staff to list these via the (observedEmail == me &&
  // status == 'Finalized') branch.
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

  // Draft Work Product / Instructional Round observations (rules allow
  // observed staff to read drafts of these types).
  const { observation: wpDraft } = useActiveWorkProductObservation(emailLower);
  const { observation: irDraft } = useActiveInstructionalRoundObservation(emailLower);

  // Question banks for the progress bars.
  const wpQuestions = useFirestoreCollection(COLLECTIONS.workProductQuestions);

  // Whether this staff member's role/year currently has WP / IR active —
  // shared with the sidebar via the existing context provider.
  const { hasWorkProduct, hasInstructionalRound } = useActiveObservationTypes();

  const finalizedStandard = useMemo(
    () => (finalizedObs ?? []).filter((o) => o.type === OBSERVATION_TYPES.standard),
    [finalizedObs],
  );

  return {
    staff,
    config: config ?? null,
    quickMaterials: quick?.items ?? [],
    appSettings: appSettings ?? null,
    finalizedStandard,
    workProductDraft: wpDraft,
    instructionalRoundDraft: irDraft,
    workProductQuestionsCount: wpQuestions.data?.length ?? 0,
    // IR uses the same workProductQuestions collection in this schema
    // (questions are admin-curated and shared across both types).
    instructionalRoundQuestionsCount: wpQuestions.data?.length ?? 0,
    hasWorkProduct,
    hasInstructionalRound,
    loading: staffLoading,
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
  staff: Staff;
  tasks: CheckpointWithStatus[];
  cycleYearLabel: string;
  yearTierLabel: string;
  showTimeline: boolean;
}
function Hero({ firstName, staff, tasks, cycleYearLabel, yearTierLabel, showTimeline }: HeroProps) {
  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const next = tasks.find((t) => t.status === 'inprogress' || t.status === 'soon');

  return (
    <section className="dash-hero">
      <div className="dash-hero__top">
        <div className="dash-hero__copy">
          <span className="dash-hero__eyebrow">
            {staff.summativeYear ? 'Summative cycle' : 'Formative cycle'} · {cycleYearLabel}
          </span>
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
              <>No active checkpoints right now. Check back when an observation is scheduled.</>
            )}
          </p>
          <div className="dash-hero__meta">
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{yearTierLabel}</span>
              <span className="dash-hero__meta-label">
                {staff.summativeYear ? 'Summative' : 'Formative'}
              </span>
            </div>
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{done}</span>
              <span className="dash-hero__meta-label">Completed</span>
            </div>
            <div className="dash-hero__meta-item">
              <span className="dash-hero__meta-num">{cycleCloseLabel()}</span>
              <span className="dash-hero__meta-label">Cycle close</span>
            </div>
          </div>
        </div>
        <ProgressRing value={done} total={Math.max(total, 1)} />
      </div>
      {showTimeline ? <Timeline tasks={tasks} cycleYearLabel={cycleYearLabel} /> : null}
    </section>
  );
}

function cycleCloseLabel(): string {
  // Cycle nominally closes mid-May for both tiers in OPS.
  return 'May 15';
}

function yearTierLabelFor(year: number): string {
  if (year >= 4) {
    const p = year - 3;
    return `Probationary Y${String(p)}`;
  }
  return `Year ${String(year)}`;
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
function TaskCard({
  task,
  featured,
  onAcknowledge,
  acknowledging,
}: {
  task: CheckpointWithStatus;
  featured?: boolean;
  onAcknowledge?: (observationId: string) => void;
  acknowledging?: boolean;
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
          isAck && task.ackObservationId && onAcknowledge ? (
            <button
              type="button"
              className={`ot-btn ${featured ? 'ot-btn--primary' : 'ot-btn--secondary'} ot-btn--sm task__cta`}
              onClick={() => onAcknowledge(task.ackObservationId ?? '')}
              disabled={acknowledging}
            >
              {acknowledging ? 'Acknowledging…' : task.cta}
            </button>
          ) : task.ctaUrl ? (
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

// ─── Right column ────────────────────────────────────────────────────────────
function EvaluatorCard({ pe }: { pe: { name: string; email: string; role: string } | null }) {
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
              <a href={`mailto:${pe.email}`}>{pe.email}</a>
            </div>
          </div>
          <a
            href={`mailto:${pe.email}`}
            className="ot-btn ot-btn--primary ot-btn--sm"
            style={{ width: '100%' }}
          >
            Send a message
          </a>
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
  const queryClient = useQueryClient();

  const sections = data.config?.sections ?? DEFAULT_SECTIONS;

  const tasks = useMemo<CheckpointWithStatus[]>(() => {
    if (!data.staff) return [];
    return deriveCheckpoints(data.config?.checkpoints ?? {}, {
      finalizedStandard: data.finalizedStandard,
      workProductDraft: data.workProductDraft,
      instructionalRoundDraft: data.instructionalRoundDraft,
      finalizedWorkProduct: null,
      finalizedInstructionalRound: null,
      workProductQuestionsCount: data.workProductQuestionsCount,
      instructionalRoundQuestionsCount: data.instructionalRoundQuestionsCount,
      appSettings: data.appSettings,
      hasWorkProduct: data.hasWorkProduct,
      hasInstructionalRound: data.hasInstructionalRound,
    });
  }, [
    data.staff,
    data.config,
    data.finalizedStandard,
    data.workProductDraft,
    data.instructionalRoundDraft,
    data.workProductQuestionsCount,
    data.instructionalRoundQuestionsCount,
    data.appSettings,
    data.hasWorkProduct,
    data.hasInstructionalRound,
  ]);

  // Acknowledge mutation — used by the Acknowledge checkpoint's button.
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

  if (data.loading && !data.staff) {
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

  // Peer evaluator: derived from the most recent observation we can see.
  // Prefers the still-Draft WP/IR (most active touchpoint), falls back to
  // the most recent finalized Standard.
  const peSource =
    data.workProductDraft ?? data.instructionalRoundDraft ?? data.finalizedStandard[0] ?? null;
  const pe = peSource
    ? {
        name: peSource.observerEmail.split('@')[0] ?? peSource.observerEmail,
        email: peSource.observerEmail,
        role: 'Peer Evaluator',
      }
    : null;

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
  const yearTierLabel = yearTierLabelFor(data.staff.year);

  return (
    <div className="staff-dashboard">
      <div className="page">
        {sections.hero ? (
          <Hero
            firstName={firstName}
            staff={data.staff}
            tasks={tasks}
            cycleYearLabel={cycleYearLabel}
            yearTierLabel={yearTierLabel}
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
                      onAcknowledge={(id) => ackMutation.mutate(id)}
                      acknowledging={ackMutation.isPending}
                    />
                  </section>
                ) : null}
                {restActive.length > 0 ? (
                  <TaskGroup title="In progress" count={restActive.length}>
                    {restActive.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        onAcknowledge={(id) => ackMutation.mutate(id)}
                        acknowledging={ackMutation.isPending}
                      />
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
                  active.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      onAcknowledge={(id) => ackMutation.mutate(id)}
                      acknowledging={ackMutation.isPending}
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
            {sections.quickMaterials ? <QuickMaterials items={data.quickMaterials} /> : null}
            {sections.peerEvaluatorCard ? <EvaluatorCard pe={pe} /> : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

// School-year label: runs Aug → July, so anything before Aug uses the prior
// Sept→May pair. Mirrors how the rest of the system thinks about cycles.
function currentSchoolYearLabel(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 7 ? year : year - 1;
  return `${String(startYear)} — ${String(startYear + 1)}`;
}

export type { CheckpointStatus };
