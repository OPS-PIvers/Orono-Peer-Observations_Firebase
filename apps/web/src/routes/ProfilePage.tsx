import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, orderBy, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { AlertCircle, CalendarCheck, CalendarX, ChevronRight, Loader2, Mail } from 'lucide-react';
import {
  COLLECTIONS,
  DEFAULT_EMAIL_PREFERENCES,
  EMAIL_PREFERENCE_CATEGORIES,
  EMAIL_PREFERENCE_CATEGORY_LABELS,
  OBSERVATION_STATUS,
  SPECIAL_ROLES,
  type CalendarConnectionStatusResult,
  type EmailPreferences,
  type Observation,
  type Role,
  type Staff,
  type UpdateEmailPreferencesInput,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { PROFICIENCY_LABELS } from '@/components/rubric/RubricGrid';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useDocument } from '@/hooks/useDocument';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db, functions } from '@/lib/firebase';
import { beginCalendarConnect } from '@/scheduling/connectCalendar';
import { computeGrowthTrend, type GrowthTrendSeries } from '@/utils/growthTrend';
import { roleDisplayName } from '@/utils/roleLookup';
import {
  schoolYearOf,
  toJsDate,
  yearBadgeClass,
  yearLabel,
  yearStatusLabel,
} from '@/utils/staffFormatting';

/** Domain-id → chart stroke color, mirroring RubricGridEditor's
 *  `DOMAIN_ACCENTS` (border-l-ops-blue/red/blue-light/red-light) so a given
 *  rubric domain reads as the same color everywhere in the app. Falls back
 *  to cycling through the same four brand tones for rubrics with a
 *  differently-keyed domain id. Order follows DESIGN.md's chart-sequencing
 *  convention (blue-700 → red-700 → blue-600 → red-600). */
const DOMAIN_CHART_COLORS: Record<string, string> = {
  '1': 'var(--color-ops-blue)',
  '2': 'var(--color-ops-red)',
  '3': 'var(--color-ops-blue-light)',
  '4': 'var(--color-ops-red-light)',
};
const FALLBACK_CHART_COLORS = [
  'var(--color-ops-blue)',
  'var(--color-ops-red)',
  'var(--color-ops-blue-light)',
  'var(--color-ops-red-light)',
];
function chartColorForDomain(domainId: string, index: number): string {
  return (
    DOMAIN_CHART_COLORS[domainId] ??
    FALLBACK_CHART_COLORS[index % FALLBACK_CHART_COLORS.length] ??
    'var(--color-ops-blue)'
  );
}

const PROFICIENCY_LEVEL_LABELS = [
  PROFICIENCY_LABELS.developing,
  PROFICIENCY_LABELS.basic,
  PROFICIENCY_LABELS.proficient,
  PROFICIENCY_LABELS.distinguished,
];

/**
 * "My growth" — self-only proficiency trend by rubric domain (STAFF-08).
 *
 * Deliberately self-only: no org-aggregate/district-average comparison
 * line. Adding one would be a new data-exposure surface and would read as
 * ranking teachers against each other in an evaluation context.
 *
 * Hand-rolled inline SVG (no charting dependency), following the
 * `ProgressRing`/`Timeline` precedent in DashboardView.tsx. The chart
 * carries an accessible name + description (`<title>`/`<desc>`) plus a
 * visually-hidden data table with the full underlying values, so the trend
 * is available to screen-reader users too.
 */
function MyGrowthTrendSection({ series }: { series: GrowthTrendSeries[] }) {
  if (series.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="font-heading text-ops-blue-dark text-lg font-semibold">My growth</h2>
        <p className="text-ops-gray mt-2 text-sm italic">
          Your proficiency trend will appear here once a finalized observation includes rubric
          scoring.
        </p>
      </section>
    );
  }

  const width = 640;
  const height = 280;
  const marginLeft = 100;
  const marginRight = 16;
  const marginTop = 16;
  const marginBottom = 32;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;

  const allPoints = series.flatMap((s) => s.points);
  const times = allPoints.map((p) => p.date.getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeRange = maxTime - minTime;

  const xFor = (date: Date) =>
    marginLeft +
    (timeRange === 0 ? plotWidth / 2 : ((date.getTime() - minTime) / timeRange) * plotWidth);
  const yFor = (average: number) => marginTop + (1 - average / 3) * plotHeight;

  const observationCount = new Set(allPoints.map((p) => p.observationId)).size;
  const startLabel = new Date(minTime).toLocaleDateString();
  const endLabel = new Date(maxTime).toLocaleDateString();

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="font-heading text-ops-blue-dark text-lg font-semibold">My growth</h2>
      <p className="text-ops-gray mt-1 text-sm">
        Your average proficiency rating per rubric domain across your finalized observations.
      </p>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          className="h-auto w-full min-w-[480px]"
          role="img"
          aria-labelledby="my-growth-trend-title my-growth-trend-desc"
        >
          <title id="my-growth-trend-title">My growth: proficiency trend by rubric domain</title>
          <desc id="my-growth-trend-desc">
            Line chart of {series.length} rubric domain{series.length === 1 ? '' : 's'} across{' '}
            {observationCount} finalized observation{observationCount === 1 ? '' : 's'} from{' '}
            {startLabel} to {endLabel}, rated from Developing to Distinguished. Full values are
            listed in the table below the chart.
          </desc>

          {PROFICIENCY_LEVEL_LABELS.map((label, i) => {
            const y = yFor(i);
            return (
              <g key={label}>
                <line
                  x1={marginLeft}
                  x2={width - marginRight}
                  y1={y}
                  y2={y}
                  stroke="var(--color-ops-gray-lighter)"
                  strokeWidth={1}
                />
                <text
                  x={marginLeft - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="var(--color-ops-gray)"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {series.map((s, i) => {
            const color = chartColorForDomain(s.domainId, i);
            const points = s.points
              .map((p) => `${String(xFor(p.date))},${String(yFor(p.average))}`)
              .join(' ');
            return (
              <g key={s.domainId}>
                <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
                {s.points.map((p) => (
                  <circle
                    key={p.observationId}
                    cx={xFor(p.date)}
                    cy={yFor(p.average)}
                    r={3.5}
                    fill={color}
                  />
                ))}
              </g>
            );
          })}

          <text
            x={marginLeft}
            y={height - 8}
            textAnchor="start"
            fontSize={10}
            fill="var(--color-ops-gray)"
          >
            {startLabel}
          </text>
          <text
            x={width - marginRight}
            y={height - 8}
            textAnchor="end"
            fontSize={10}
            fill="var(--color-ops-gray)"
          >
            {endLabel}
          </text>
        </svg>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s, i) => (
          <li key={s.domainId} className="flex items-center gap-1.5 text-xs text-gray-700">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: chartColorForDomain(s.domainId, i) }}
              aria-hidden="true"
            />
            {s.domainName}
          </li>
        ))}
      </ul>

      {/* Visually-hidden data table — the full text alternative for the
          hand-rolled SVG chart above (screen-reader users get every value,
          not just the chart's summary description). */}
      <table className="sr-only">
        <caption>My growth: proficiency by rubric domain and observation date</caption>
        <thead>
          <tr>
            <th scope="col">Rubric domain</th>
            <th scope="col">Observation</th>
            <th scope="col">Date</th>
            <th scope="col">Average proficiency</th>
          </tr>
        </thead>
        <tbody>
          {series.flatMap((s) =>
            s.points.map((p) => (
              <tr key={`${s.domainId}-${p.observationId}`}>
                <td>{s.domainName}</td>
                <td>{p.observationName}</td>
                <td>{p.date.toLocaleDateString()}</td>
                <td>
                  {PROFICIENCY_LEVEL_LABELS[Math.round(p.average)]} ({p.average.toFixed(2)} of 3
                  &nbsp;&mdash; {p.scoredCount} of {p.totalCount} components scored)
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}

const ADMIN_CONSTRAINTS = [
  where('role', '==', SPECIAL_ROLES.administrator),
  where('isActive', '==', true),
  orderBy('name', 'asc'),
];

const getCalendarConnectionStatusFn = httpsCallable<
  Record<string, never>,
  CalendarConnectionStatusResult
>(functions, 'getCalendarConnectionStatus');
const disconnectGoogleCalendarFn = httpsCallable<
  Record<string, never>,
  CalendarConnectionStatusResult
>(functions, 'disconnectGoogleCalendar');
const updateEmailPreferencesFn = httpsCallable<UpdateEmailPreferencesInput, EmailPreferences>(
  functions,
  'updateEmailPreferences',
);

/** Calendar integration section: connect/disconnect Google Calendar OAuth. */
function CalendarIntegrationSection({ email }: { email: string }) {
  const [status, setStatus] = useState<CalendarConnectionStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await getCalendarConnectionStatusFn({});
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleConnect = () => {
    setError(null);
    try {
      beginCalendarConnect(email, '/profile');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the connection.');
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await disconnectGoogleCalendarFn({});
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect.');
    } finally {
      setBusy(false);
    }
  };

  const isConnected = status?.status === 'connected';
  const isRevoked = status?.status === 'revoked';
  const connectedEmail = isConnected ? status.googleAccountEmail : null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="font-heading text-ops-blue-dark text-lg font-semibold">
        Calendar integration
      </h2>
      <p className="text-ops-gray mt-1 text-sm">
        Connect your Google Calendar so observation events can be added automatically.
      </p>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-700">
          <Loader2 className="text-ops-blue h-4 w-4 animate-spin" />
          Checking connection…
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-2.5">
            {isConnected ? (
              <>
                <CalendarCheck className="h-5 w-5 text-green-600" />
                <p className="text-sm text-gray-900">
                  Connected{connectedEmail ? ` as ${connectedEmail}` : ''}
                </p>
              </>
            ) : isRevoked ? (
              <>
                <CalendarX className="text-ops-red h-5 w-5" />
                <p className="text-sm text-gray-900">
                  Access was revoked — reconnect to keep calendar sync working.
                </p>
              </>
            ) : (
              <>
                <CalendarX className="text-ops-gray h-5 w-5" />
                <p className="text-sm text-gray-900">Not connected</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {isConnected ? (
              <Button variant="outline" onClick={() => void handleDisconnect()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Disconnect
              </Button>
            ) : (
              <Button onClick={handleConnect} disabled={!email}>
                {isRevoked ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
              </Button>
            )}
          </div>
        </div>
      )}

      {error ? (
        <div className="mt-4 flex items-start gap-2 text-sm">
          <AlertCircle className="text-ops-red mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-ops-red">{error}</p>
        </div>
      ) : null}
    </section>
  );
}

/** Email preferences section: per-category opt-in/out toggles, backed by the
 *  updateEmailPreferences callable (own /staff doc is client-read-only, so a
 *  callable is the only self-service write path — see firestore.rules). */
function EmailPreferencesSection({ staff }: { staff: Staff }) {
  const [prefs, setPrefs] = useState<EmailPreferences>({
    ...DEFAULT_EMAIL_PREFERENCES,
    ...staff.emailPreferences,
  });
  const [savingCategory, setSavingCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrefs({ ...DEFAULT_EMAIL_PREFERENCES, ...staff.emailPreferences });
  }, [staff.emailPreferences]);

  const handleToggle = async (category: keyof EmailPreferences, checked: boolean) => {
    const previous = prefs;
    setError(null);
    setSavingCategory(category);
    setPrefs((p) => ({ ...p, [category]: checked }));
    try {
      const { data } = await updateEmailPreferencesFn({ [category]: checked });
      setPrefs(data);
    } catch (err) {
      setPrefs(previous);
      setError(err instanceof Error ? err.message : 'Failed to save your preference.');
    } finally {
      setSavingCategory(null);
    }
  };

  return (
    <section
      id="email-preferences"
      className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 className="font-heading text-ops-blue-dark text-lg font-semibold">Email preferences</h2>
      <p className="text-ops-gray mt-1 text-sm">
        Turn off any notification category you don&apos;t want to receive by email. Booking
        confirmations, cancellations/reschedules, and account-related notices always send regardless
        of these settings.
      </p>

      <ul className="mt-4 divide-y divide-gray-100">
        {EMAIL_PREFERENCE_CATEGORIES.map((category) => {
          const { label, description } = EMAIL_PREFERENCE_CATEGORY_LABELS[category];
          return (
            <li key={category} className="flex items-center justify-between gap-4 py-3">
              <label htmlFor={`email-pref-${category}`} className="flex-1">
                <span className="block text-sm font-medium text-gray-900">{label}</span>
                <span className="text-ops-gray block text-xs">{description}</span>
              </label>
              <Switch
                id={`email-pref-${category}`}
                checked={prefs[category]}
                disabled={savingCategory === category}
                onCheckedChange={(checked) => void handleToggle(category, checked)}
                aria-label={label}
              />
            </li>
          );
        })}
      </ul>

      {error ? (
        <div className="mt-4 flex items-start gap-2 text-sm">
          <AlertCircle className="text-ops-red mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-ops-red">{error}</p>
        </div>
      ) : null}
    </section>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const email = user?.email?.toLowerCase() ?? '';

  const staffDocRef = useMemo(() => (email ? doc(db, COLLECTIONS.staff, email) : null), [email]);
  const { data: staff, loading: staffLoading } = useDocument<Staff>(staffDocRef);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: administrators } = useFirestoreCollection<Staff>(
    COLLECTIONS.staff,
    ADMIN_CONSTRAINTS,
  );

  // Per-staff observations. Single equality filter — Firestore auto-indexes
  // it, no composite index needed. Sorting + status filter happen below in
  // `finalizedByYear`.
  const obsConstraints = useMemo(
    () => (email ? [where('observedEmail', '==', email)] : []),
    [email],
  );
  const { data: observations } = useFirestoreCollection<Observation>(
    COLLECTIONS.observations,
    obsConstraints,
    [email],
  );

  const myAdmins = useMemo(() => {
    if (!staff || !administrators) return [];
    const myBuildings = new Set(staff.buildings);
    return administrators.filter((a) => a.buildings.some((b) => myBuildings.has(b)));
  }, [staff, administrators]);

  const finalizedByYear = useMemo(() => {
    interface Row {
      obs: Observation & { id: string };
      date: Date;
    }
    const finalized: Row[] = [];
    for (const o of observations ?? []) {
      if (o.status !== OBSERVATION_STATUS.finalized) continue;
      const date = toJsDate(o.observationDate);
      if (!date) continue;
      finalized.push({ obs: o, date });
    }
    finalized.sort((a, b) => b.date.getTime() - a.date.getTime());

    const out = new Map<string, Row[]>();
    for (const row of finalized) {
      const yr = schoolYearOf(row.date);
      const list = out.get(yr) ?? [];
      list.push(row);
      out.set(yr, list);
    }
    // Map preserves insertion order — first key is the most recent school
    // year (we sorted desc above), so iterating yields newest → oldest.
    return Array.from(out.entries());
  }, [observations]);

  const growthTrend = useMemo(() => computeGrowthTrend(observations ?? []), [observations]);

  if (staffLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-32 rounded-lg bg-gray-100" />
        <div className="h-24 rounded-lg bg-gray-100" />
        <div className="h-40 rounded-lg bg-gray-100" />
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="py-16 text-center">
        <p className="text-ops-gray font-medium">
          We couldn&apos;t find your staff record. Contact your site admin.
        </p>
      </div>
    );
  }

  const roleLabel = roleDisplayName(roles, staff.role);

  return (
    <PageHeader title="Profile" subtitle="Your record at a glance.">
      <div className="space-y-6">
        {/* Identity card */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-ops-blue-dark text-2xl font-semibold">
                {staff.name}
              </h2>
              <p className="text-ops-gray mt-1 text-sm">
                <a href={`mailto:${staff.email}`} className="text-ops-blue hover:underline">
                  {staff.email}
                </a>
              </p>
            </div>
            <span
              className={`inline-flex items-center rounded px-2 py-1 text-xs font-semibold ${yearBadgeClass(staff.year)}`}
              title={yearStatusLabel(staff.year, staff.summativeYear)}
            >
              {yearLabel(staff.year)}
              {staff.summativeYear ? ' · Summative' : ''}
            </span>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-ops-gray text-[11px] font-semibold tracking-wide uppercase">
                Role
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{roleLabel || '—'}</dd>
            </div>
            <div>
              <dt className="text-ops-gray text-[11px] font-semibold tracking-wide uppercase">
                Status
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {yearStatusLabel(staff.year, staff.summativeYear)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-ops-gray text-[11px] font-semibold tracking-wide uppercase">
                Building{staff.buildings.length === 1 ? '' : 's'}
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {staff.buildings.length === 0 ? (
                  <span className="text-ops-gray text-sm italic">Not assigned</span>
                ) : (
                  staff.buildings.map((b) => (
                    <span key={b} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {b}
                    </span>
                  ))
                )}
              </dd>
            </div>
          </dl>
        </section>

        {/* Administrators card */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-heading text-ops-blue-dark text-lg font-semibold">
            My Administrator{myAdmins.length === 1 ? '' : 's'}
          </h2>
          {myAdmins.length === 0 ? (
            <p className="text-ops-gray mt-2 text-sm italic">
              No administrator on file for your building{staff.buildings.length === 1 ? '' : 's'}.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {myAdmins.map((a) => (
                <li key={a.email} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="font-medium text-gray-900">{a.name}</p>
                    <p className="text-ops-gray text-xs">{a.buildings.join(', ')}</p>
                  </div>
                  <a
                    href={`mailto:${a.email}`}
                    className="text-ops-blue inline-flex items-center gap-1.5 text-sm hover:underline"
                  >
                    <Mail className="h-4 w-4" />
                    {a.email}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Calendar integration */}
        <CalendarIntegrationSection email={email} />

        {/* Email preferences */}
        <EmailPreferencesSection staff={staff} />

        {/* Finalized observations archive */}
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-heading text-ops-blue-dark text-lg font-semibold">
            Finalized observations
          </h2>
          {finalizedByYear.length === 0 ? (
            <p className="text-ops-gray mt-2 text-sm italic">No finalized observations yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {finalizedByYear.map(([year, rows], idx) => (
                <details
                  key={year}
                  open={idx === 0}
                  className="group overflow-hidden rounded-md border border-gray-200"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                    <span className="font-heading text-ops-blue-dark font-semibold">
                      {year}{' '}
                      <span className="text-ops-gray text-sm font-normal">
                        ({String(rows.length)})
                      </span>
                    </span>
                    <ChevronRight className="text-ops-gray h-4 w-4 transition-transform group-open:rotate-90" />
                  </summary>
                  <ul className="divide-y divide-gray-100 border-t border-gray-200">
                    {rows.map(({ obs: o, date }) => (
                      <li key={o.id} className="hover:bg-ops-blue-lighter/30">
                        <Link
                          to={`/observations/${o.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                        >
                          <span className="font-medium text-gray-900">
                            {o.observationName || (
                              <span className="text-ops-gray italic">Untitled observation</span>
                            )}
                          </span>
                          <span className="text-ops-gray text-xs">{date.toLocaleDateString()}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </section>

        {/* My growth — self-only proficiency trend by rubric domain (STAFF-08). */}
        {finalizedByYear.length > 0 ? <MyGrowthTrendSection series={growthTrend} /> : null}
      </div>
    </PageHeader>
  );
}
