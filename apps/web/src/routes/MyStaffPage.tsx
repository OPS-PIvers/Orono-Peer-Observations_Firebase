import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { doc, orderBy } from 'firebase/firestore';
import { COLLECTIONS, type Staff } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useDocument } from '@/hooks/useDocument';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';

type StaffTab = 'all' | 'probationary' | 'highCycle';

function yearLabel(year: number): string {
  return year < 4 ? `Y${String(year)}` : `P${String(year - 3)}`;
}

function yearBadgeClass(year: number): string {
  return year < 4
    ? 'bg-gray-100 text-gray-700 border border-gray-200'
    : 'bg-ops-red-lighter text-ops-red-dark border border-ops-red-lighter';
}

const ALL_STAFF_CONSTRAINTS = [orderBy('name', 'asc')];

export function MyStaffPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const adminEmail = user?.email?.toLowerCase() ?? '';

  const adminDocRef = useMemo(
    () => (adminEmail ? doc(db, COLLECTIONS.staff, adminEmail) : null),
    [adminEmail],
  );
  const { data: adminDoc, loading: adminLoading } = useDocument<Staff>(adminDocRef);
  const adminBuildings: string[] = adminDoc?.buildings ?? [];
  const missingBuildings = !adminLoading && (!adminDoc || adminBuildings.length === 0);

  const { data: allStaff, loading: staffLoading } = useFirestoreCollection<Staff>(
    COLLECTIONS.staff,
    ALL_STAFF_CONSTRAINTS,
  );

  const buildingScoped = useMemo(() => {
    if (!allStaff) return [];
    if (missingBuildings) return allStaff.filter((s) => s.isActive);
    return allStaff.filter(
      (s) => s.isActive && s.buildings.some((b) => adminBuildings.includes(b)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStaff, adminBuildings.join(','), missingBuildings]);

  const probationary = useMemo(
    () => buildingScoped.filter((s) => s.year >= 4),
    [buildingScoped],
  );
  const highCycle = useMemo(
    () => buildingScoped.filter((s) => s.summativeYear && s.year < 4),
    [buildingScoped],
  );

  const [activeTab, setActiveTab] = useState<StaffTab>('all');
  const [search, setSearch] = useState('');

  const tabStaff =
    activeTab === 'all' ? buildingScoped : activeTab === 'probationary' ? probationary : highCycle;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabStaff;
    return tabStaff.filter((s) => s.name.toLowerCase().includes(q));
  }, [tabStaff, search]);

  const loading = adminLoading || staffLoading;

  const tabs: { id: StaffTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: buildingScoped.length },
    { id: 'probationary', label: 'Probationary', count: probationary.length },
    { id: 'highCycle', label: 'High Cycle', count: highCycle.length },
  ];

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-heading text-ops-blue-dark text-3xl font-semibold">My Staff</h1>
        <p className="text-ops-gray mt-1 text-sm">Building-scoped staff for your site</p>
      </header>

      {missingBuildings ? (
        <div className="bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md px-4 py-3 text-sm">
          Your building assignment isn&apos;t configured. Contact your site admin.
        </div>
      ) : null}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="border-input bg-background h-10 w-full max-w-sm rounded-md border px-3 text-sm"
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex overflow-hidden rounded-lg border border-gray-200 bg-white">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-ops-blue font-semibold text-white'
                : 'text-ops-gray hover:bg-ops-blue-lighter hover:text-ops-blue-dark'
            }`}
          >
            {tab.label} ({String(tab.count)})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-ops-blue text-white">
              {['Name', 'Role', 'Year', 'Buildings', 'High Cycle', 'Actions'].map((h) => (
                <th
                  key={h}
                  className="font-heading px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !allStaff ? (
              <tr>
                <td colSpan={6} className="text-ops-gray py-6 text-center text-sm">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-ops-gray py-6 text-center text-sm">
                  No staff found.
                </td>
              </tr>
            ) : (
              filtered.map((s, i) => (
                <tr
                  key={s.id}
                  className={`transition-colors hover:bg-ops-blue-lighter/40 ${i % 2 === 0 ? 'bg-white' : 'bg-ops-gray-lightest'}`}
                >
                  <td className="px-4 py-3">
                    <Link to={`/staff/${s.email}`} className="text-ops-blue font-medium hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="text-ops-gray px-4 py-3">{s.role}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${yearBadgeClass(s.year)}`}
                    >
                      {yearLabel(s.year)}
                    </span>
                  </td>
                  <td className="text-ops-gray px-4 py-3 text-xs">
                    {s.buildings.join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {s.summativeYear ? (
                      <span className="text-green-600 font-semibold">✓</span>
                    ) : (
                      <span className="text-ops-gray-lighter">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void navigate(`/staff/${s.email}`)}
                    >
                      View observations
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
