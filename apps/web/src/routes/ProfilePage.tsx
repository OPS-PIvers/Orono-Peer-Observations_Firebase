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
 *  rubric domain reads as the same color everywhere in the app. */
const DOMAIN_CHART_COLORS: Record<string, string> = {
  '1': 'var(--color-ops-blue)',
  '2': 'var(--color-ops-red)',
  '3': 'var(--color-ops-blue-light)',
  '4': 'var(--color-ops-red-light)',
};
/** Full 6-step chart-series ramp from DESIGN.md's chart-sequencing
 *  convention (blue-700 → red-700 → blue-600 → red-600 → blue-400 →
 *  red-400). The last two steps have no `--color-ops-*` custom property in
 *  this app (only the 4 used above are wired up), so they're inlined as
 *  the literal computed-tint hex values DESIGN.md documents for them —
 *  not a new, off-palette hue. */
const FALLBACK_CHART_COLORS = [
  'var(--color-ops-blue)',
  'var(--color-ops-red)',
  'var(--color-ops-blue-light)',
  'var(--color-ops-red-light)',
  '#6d7cb5', // blue-400 (DESIGN.md computed tint)
  '#d06f70', // red-400 (DESIGN.md computed tint)
];
/** `FALLBACK_CHART_COLORS[0]` as a definite `string` — the array literal
 *  above is always non-empty, but TypeScript can't infer that from an
 *  indexed access, so this is the one place that's spelled out instead of
 *  reaching for a non-null assertion everywhere a default color is needed. */
const DEFAULT_CHART_COLOR = FALLBACK_CHART_COLORS[0] ?? 'var(--color-ops-blue)';
/** Non-color differentiators (WCAG 1.4.1 Use of Color) — every series gets
 *  a dash pattern + marker shape from its position within the chart, so
 *  two series never render identically even when the color palette above
 *  has to repeat. 4 dash patterns × 4 marker shapes = 16 distinguishable
 *  combinations per chart, far more than a rubric's realistic domain
 *  count, and each rubric's series render as their own chart (see
 *  `MyGrowthTrendSection`) so this only ever has to cover one rubric's
 *  domains at a time. */
const CHART_DASH_PATTERNS = ['', '7 4', '2 3', '9 3 2 3'];
type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle';
const CHART_MARKER_SHAPES: MarkerShape[] = ['circle', 'square', 'diamond', 'triangle'];

interface SeriesVisualStyle {
  color: string;
  dash: string;
  marker: MarkerShape;
}

/**
 * Assigns each series in one rubric's chart a distinguishable color, dash
 * pattern, and marker shape.
 *
 * Domains numbered '1'-'4' (the framework convention) get the app-wide
 * brand color for that domain id. Any other domain id — a rubric with more
 * than 4 domains, or a differently-keyed one — draws from the remaining,
 * not-yet-claimed colors in `FALLBACK_CHART_COLORS` so it can never
 * silently collide with a mapped domain's color.
 *
 * Independent of color, every series also gets a dash pattern + marker
 * shape keyed to its position in `series` — this is the actual
 * distinguishability guarantee (finding: WCAG 1.4.1), since the color
 * palette alone can still repeat once a rubric has more domains than
 * `FALLBACK_CHART_COLORS` has entries.
 */
function computeSeriesStyles(series: readonly GrowthTrendSeries[]): Map<string, SeriesVisualStyle> {
  const styles = new Map<string, SeriesVisualStyle>();
  const usedColors = new Set<string>();
  const unmapped: GrowthTrendSeries[] = [];

  for (const s of series) {
    const mapped = DOMAIN_CHART_COLORS[s.domainId];
    if (mapped) {
      styles.set(s.domainId, { color: mapped, dash: '', marker: 'circle' });
      usedColors.add(mapped);
    } else {
      unmapped.push(s);
    }
  }

  const availableColors = FALLBACK_CHART_COLORS.filter((c) => !usedColors.has(c));
  const colorPalette = availableColors.length > 0 ? availableColors : FALLBACK_CHART_COLORS;
  unmapped.forEach((s, i) => {
    styles.set(s.domainId, {
      color: colorPalette[i % colorPalette.length] ?? DEFAULT_CHART_COLOR,
      dash: '',
      marker: 'circle',
    });
  });

  series.forEach((s, i) => {
    const existing = styles.get(s.domainId);
    const dash =
      CHART_DASH_PATTERNS[
        Math.floor(i / CHART_MARKER_SHAPES.length) % CHART_DASH_PATTERNS.length
      ] ?? '';
    const marker = CHART_MARKER_SHAPES[i % CHART_MARKER_SHAPES.length] ?? 'circle';
    styles.set(s.domainId, { color: existing?.color ?? DEFAULT_CHART_COLOR, dash, marker });
  });

  return styles;
}

/** Renders a series' point marker as a distinct shape (not just a colored
 *  dot) so the chart never relies on color alone to tell two series apart. */
function SeriesMarker({
  shape,
  cx,
  cy,
  color,
}: {
  shape: MarkerShape;
  cx: number;
  cy: number;
  color: string;
}) {
  switch (shape) {
    case 'square':
      return <rect x={cx - 3} y={cy - 3} width={6} height={6} fill={color} />;
    case 'diamond':
      return (
        <path
          d={`M ${String(cx)} ${String(cy - 4.2)} L ${String(cx + 4.2)} ${String(cy)} L ${String(cx)} ${String(cy + 4.2)} L ${String(cx - 4.2)} ${String(cy)} Z`}
          fill={color}
        />
      );
    case 'triangle':
      return (
        <path
          d={`M ${String(cx)} ${String(cy - 4.5)} L ${String(cx + 4)} ${String(cy + 3.2)} L ${String(cx - 4)} ${String(cy + 3.2)} Z`}
          fill={color}
        />
      );
    case 'circle':
    default:
      return <circle cx={cx} cy={cy} r={3.5} fill={color} />;
  }
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
/** Renders the accessible text label for one point's average proficiency,
 *  guarding against the accessible table ever showing "undefined" or "NaN"
 *  — `PROFICIENCY_LEVEL_LABELS[Math.round(average)]` is undefined if
 *  `average` is ever NaN or out of [0,3], which would otherwise render as
 *  the literal string "undefined" next to the number. `computeGrowthTrend`
 *  should never produce such a value (unrecognized proficiencies are
 *  skipped before they can corrupt the average), but the table's own
 *  rendering doesn't rely on that invariant holding forever. */
function proficiencyAverageLabel(average: number): string {
  const rounded = Math.round(average);
  const label = PROFICIENCY_LEVEL_LABELS[rounded];
  return label ?? 'Unknown';
}

/** One rubric's proficiency-by-domain line chart, plus its legend and
 *  accessible data table. Extracted so `MyGrowthTrendSection` can render
 *  one of these per rubric the staff member has been observed under
 *  (see that component's doc comment for why rubrics are never merged). */
function RubricGrowthChart({
  rubricName,
  series,
  headingId,
}: {
  rubricName: string;
  series: GrowthTrendSeries[];
  headingId: string;
}) {
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
  const styles = computeSeriesStyles(series);
  const titleId = `${headingId}-title`;
  const descId = `${headingId}-desc`;

  return (
    <div>
      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          className="h-auto w-full min-w-[480px]"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
        >
          <title id={titleId}>{rubricName}: proficiency trend by rubric domain</title>
          <desc id={descId}>
            Line chart of {series.length} rubric domain{series.length === 1 ? '' : 's'} in the{' '}
            {rubricName} across {observationCount} finalized observation
            {observationCount === 1 ? '' : 's'} from {startLabel} to {endLabel}, rated from
            Developing to Distinguished. Each domain is drawn with its own line color, dash pattern,
            and point marker shape. Full values are listed in the table below the chart.
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

          {series.map((s) => {
            const style = styles.get(s.domainId) ?? {
              color: DEFAULT_CHART_COLOR,
              dash: '',
              marker: 'circle' as MarkerShape,
            };
            const points = s.points
              .map((p) => `${String(xFor(p.date))},${String(yFor(p.average))}`)
              .join(' ');
            return (
              <g key={s.domainId}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={style.color}
                  strokeWidth={2}
                  strokeDasharray={style.dash || undefined}
                />
                {s.points.map((p) => (
                  <SeriesMarker
                    key={p.observationId}
                    shape={style.marker}
                    cx={xFor(p.date)}
                    cy={yFor(p.average)}
                    color={style.color}
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

      {/* Direct, non-color-keyed legend: each entry shows the domain's line
          via a small inline SVG swatch carrying the same dash pattern +
          marker shape as the chart, not just a colored dot (WCAG 1.4.1). */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s) => {
          const style = styles.get(s.domainId) ?? {
            color: DEFAULT_CHART_COLOR,
            dash: '',
            marker: 'circle' as MarkerShape,
          };
          return (
            <li key={s.domainId} className="flex items-center gap-1.5 text-xs text-gray-700">
              <svg width={24} height={12} aria-hidden="true" className="shrink-0">
                <line
                  x1={1}
                  x2={23}
                  y1={6}
                  y2={6}
                  stroke={style.color}
                  strokeWidth={2}
                  strokeDasharray={style.dash || undefined}
                />
                <SeriesMarker shape={style.marker} cx={12} cy={6} color={style.color} />
              </svg>
              {s.domainName}
            </li>
          );
        })}
      </ul>

      {/* Visually-hidden data table — the full text alternative for the
          hand-rolled SVG chart above (screen-reader users get every value,
          not just the chart's summary description). Rubric domain names are
          listed per row so the text alternative preserves the same
          rubric-vs-domain distinction as the chart. */}
      <table className="sr-only">
        <caption>{rubricName}: proficiency by rubric domain and observation date</caption>
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
                  {proficiencyAverageLabel(p.average)} ({p.average.toFixed(2)} of 3 &nbsp;&mdash;{' '}
                  {p.scoredCount} of {p.totalCount} components scored)
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

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

  // Group by rubric identity, never domain id alone (see `growthTrend.ts`'s
  // `GrowthTrendSeries` doc comment for why): a staff member observed under
  // two different rubrics (e.g. after a role change) gets one chart per
  // rubric below, each clearly labeled with its rubric name, rather than
  // one chart silently averaging two incommensurable measures together.
  // Grouping preserves first-seen order, which is chronological (the
  // earliest-observed rubric's chart appears first).
  const rubricGroups = new Map<string, { rubricName: string; series: GrowthTrendSeries[] }>();
  for (const s of series) {
    let group = rubricGroups.get(s.rubricId);
    if (!group) {
      group = { rubricName: s.rubricName, series: [] };
      rubricGroups.set(s.rubricId, group);
    }
    group.series.push(s);
  }
  const groups = Array.from(rubricGroups.entries());
  const multipleRubrics = groups.length > 1;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="font-heading text-ops-blue-dark text-lg font-semibold">My growth</h2>
      <p className="text-ops-gray mt-1 text-sm">
        Your average proficiency rating per rubric domain across your finalized observations.
        {multipleRubrics
          ? " You've been observed under more than one rubric, so each rubric has its own chart below — domains aren't compared across rubrics."
          : ''}
      </p>

      {groups.map(([rubricId, group], i) => (
        <div
          key={rubricId}
          className={multipleRubrics && i > 0 ? 'mt-6 border-t border-gray-200 pt-6' : undefined}
        >
          {multipleRubrics ? (
            <h3 className="font-heading text-ops-blue-dark mt-2 text-sm font-semibold">
              {group.rubricName}
            </h3>
          ) : null}
          <RubricGrowthChart
            rubricName={group.rubricName}
            series={group.series}
            headingId={`my-growth-trend-${String(i)}`}
          />
        </div>
      ))}
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
