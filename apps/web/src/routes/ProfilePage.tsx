import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { AlertCircle, CalendarCheck, CalendarX, ChevronRight, Loader2, Mail } from 'lucide-react';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  SPECIAL_ROLES,
  type CalendarConnectionStatusResult,
  type Observation,
  type Role,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { useDocument } from '@/hooks/useDocument';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db, functions } from '@/lib/firebase';
import { beginCalendarConnect } from '@/scheduling/connectCalendar';
import { roleDisplayName } from '@/utils/roleLookup';
import {
  schoolYearOf,
  toJsDate,
  yearBadgeClass,
  yearLabel,
  yearStatusLabel,
} from '@/utils/staffFormatting';

// Equality-only — Firestore merges the auto single-field indexes (no
// composite index needed) and the security rule's list clause for active
// administrators stays provable from these filters. Name sorting happens
// client-side in `myAdmins`.
const ADMIN_CONSTRAINTS = [
  where('role', '==', SPECIAL_ROLES.administrator),
  where('isActive', '==', true),
];

const getCalendarConnectionStatusFn = httpsCallable<
  Record<string, never>,
  CalendarConnectionStatusResult
>(functions, 'getCalendarConnectionStatus');
const disconnectGoogleCalendarFn = httpsCallable<
  Record<string, never>,
  CalendarConnectionStatusResult
>(functions, 'disconnectGoogleCalendar');

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

          {isConnected ? (
            <p className="text-ops-gray text-xs">
              Connected before calendar availability sync was added? Reconnect to grant read-only
              free/busy access so your booked meetings and time off block conflicting observation
              slots automatically.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {isConnected ? (
              <>
                <Button onClick={handleConnect} disabled={!email}>
                  Reconnect to enable availability sync
                </Button>
                <Button variant="outline" onClick={() => void handleDisconnect()} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Disconnect
                </Button>
              </>
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

export function ProfilePage() {
  const { user } = useAuth();
  const email = user?.email?.toLowerCase() ?? '';

  const staffDocRef = useMemo(() => (email ? doc(db, COLLECTIONS.staff, email) : null), [email]);
  const { data: staff, loading: staffLoading } = useDocument<Staff>(staffDocRef);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: administrators, error: adminsError } = useFirestoreCollection<Staff>(
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
    return administrators
      .filter((a) => a.buildings.some((b) => myBuildings.has(b)))
      .sort((a, b) => a.name.localeCompare(b.name));
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
          {adminsError ? (
            <div className="mt-2 flex items-start gap-2 text-sm">
              <AlertCircle className="text-ops-red mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-ops-red">
                Couldn&apos;t load your administrators. Refresh the page to try again.
              </p>
            </div>
          ) : myAdmins.length === 0 ? (
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

        {/* Future: rubric-rating data viz vs. org aggregate goes here. */}
      </div>
    </PageHeader>
  );
}
