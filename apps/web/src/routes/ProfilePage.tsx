import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { doc, orderBy, where } from 'firebase/firestore';
import { ChevronRight, Mail } from 'lucide-react';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  SPECIAL_ROLES,
  type Observation,
  type Role,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useDocument } from '@/hooks/useDocument';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { roleDisplayName } from '@/utils/roleLookup';
import { schoolYearOf, yearBadgeClass, yearLabel, yearStatusLabel } from '@/utils/staffFormatting';

const ADMIN_CONSTRAINTS = [
  where('role', '==', SPECIAL_ROLES.administrator),
  where('isActive', '==', true),
  orderBy('name', 'asc'),
];

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
  );

  const myAdmins = useMemo(() => {
    if (!staff || !administrators) return [];
    const myBuildings = new Set(staff.buildings);
    return administrators.filter((a) => a.buildings.some((b) => myBuildings.has(b)));
  }, [staff, administrators]);

  const finalizedByYear = useMemo(() => {
    const finalized = (observations ?? [])
      .filter((o) => o.status === OBSERVATION_STATUS.finalized)
      .sort((a, b) => b.observationDate.getTime() - a.observationDate.getTime());
    const out = new Map<string, (Observation & { id: string })[]>();
    for (const o of finalized) {
      const yr = schoolYearOf(o.observationDate);
      const list = out.get(yr) ?? [];
      list.push(o);
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
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-ops-blue-dark text-3xl font-semibold">Profile</h1>
        <p className="text-ops-gray mt-1 text-sm">Your record at a glance.</p>
      </header>

      {/* Identity card */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-ops-blue-dark text-2xl font-semibold">{staff.name}</h2>
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

      {/* Finalized observations archive */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="font-heading text-ops-blue-dark text-lg font-semibold">
          Finalized observations
        </h2>
        {finalizedByYear.length === 0 ? (
          <p className="text-ops-gray mt-2 text-sm italic">No finalized observations yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {finalizedByYear.map(([year, obs], idx) => (
              <details
                key={year}
                open={idx === 0}
                className="group overflow-hidden rounded-md border border-gray-200"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                  <span className="font-heading text-ops-blue-dark font-semibold">
                    {year}{' '}
                    <span className="text-ops-gray text-sm font-normal">
                      ({String(obs.length)})
                    </span>
                  </span>
                  <ChevronRight className="text-ops-gray h-4 w-4 transition-transform group-open:rotate-90" />
                </summary>
                <ul className="divide-y divide-gray-100 border-t border-gray-200">
                  {obs.map((o) => (
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
                        <span className="text-ops-gray text-xs">
                          {o.observationDate.toLocaleDateString()}
                        </span>
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
  );
}
