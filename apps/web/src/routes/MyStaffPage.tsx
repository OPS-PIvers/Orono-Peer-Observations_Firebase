import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, orderBy } from 'firebase/firestore';
import { Check } from 'lucide-react';
import { COLLECTIONS, type Staff } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useDevMode } from '@/dev/DevModeContext';
import { useDocument } from '@/hooks/useDocument';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { yearBadgeClass, yearLabel } from '@/utils/staffFormatting';

type StaffTab = 'all' | 'probationary' | 'highCycle';

const ALL_STAFF_CONSTRAINTS = [orderBy('name', 'asc')];

export function MyStaffPage() {
  const { user } = useAuth();
  const { override } = useDevMode();
  const adminEmail = user?.email?.toLowerCase() ?? '';

  const adminDocRef = useMemo(
    () => (adminEmail ? doc(db, COLLECTIONS.staff, adminEmail) : null),
    [adminEmail],
  );
  const { data: adminDoc, loading: adminLoading } = useDocument<Staff>(adminDocRef);

  // Dev mode can override the building scope when impersonating Administrator
  // for a specific building. When the override is set, we ignore the user's
  // own staff doc buildings entirely.
  const overrideBuilding =
    override.role === 'administrator' && override.building ? override.building : null;
  const adminBuildings = useMemo<string[]>(
    () => (overrideBuilding ? [overrideBuilding] : (adminDoc?.buildings ?? [])),
    [overrideBuilding, adminDoc],
  );
  const missingBuildings =
    !overrideBuilding && !adminLoading && (!adminDoc || adminBuildings.length === 0);

  const { data: allStaff, loading: staffLoading } = useFirestoreCollection<Staff>(
    COLLECTIONS.staff,
    ALL_STAFF_CONSTRAINTS,
  );

  const buildingScoped = useMemo(() => {
    if (!allStaff) return [];
    if (missingBuildings) return [];
    return allStaff.filter(
      (s) => s.isActive && s.buildings.some((b) => adminBuildings.includes(b)),
    );
  }, [allStaff, adminBuildings, missingBuildings]);

  const probationary = useMemo(() => buildingScoped.filter((s) => s.year >= 4), [buildingScoped]);
  const highCycle = useMemo(
    () => buildingScoped.filter((s) => s.summativeYear && s.year < 4),
    [buildingScoped],
  );
  // Administrators see only staff who are probationary OR in a summative year.
  // The "All" tab is this union (building AND (probationary ∪ summative)).
  const inScope = useMemo(
    () => buildingScoped.filter((s) => s.year >= 4 || s.summativeYear),
    [buildingScoped],
  );

  const [activeTab, setActiveTab] = useState<StaffTab>('all');
  const [search, setSearch] = useState('');

  const tabStaff =
    activeTab === 'all' ? inScope : activeTab === 'probationary' ? probationary : highCycle;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabStaff;
    return tabStaff.filter((s) => s.name.toLowerCase().includes(q));
  }, [tabStaff, search]);

  const loading = adminLoading || staffLoading;

  const tabs: { id: StaffTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: inScope.length },
    { id: 'probationary', label: 'Probationary', count: probationary.length },
    { id: 'highCycle', label: 'High Cycle', count: highCycle.length },
  ];

  return (
    <PageHeader title="My Staff" subtitle="Building-scoped staff for your site">
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
                  className="font-heading px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !allStaff ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr
                  key={`skeleton-${String(i)}`}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-ops-gray-lightest'}
                >
                  <td className="px-4 py-3">
                    {i === 0 ? (
                      <span className="sr-only" role="status" aria-live="polite">
                        Loading staff…
                      </span>
                    ) : null}
                    <Skeleton className="h-4 w-32" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-28" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-5 w-10 rounded" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-4 w-28" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Skeleton className="mx-auto h-4 w-4" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-7 w-32" />
                  </td>
                </tr>
              ))
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
                  className={`hover:bg-ops-blue-lighter/40 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-ops-gray-lightest'}`}
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/staff/${encodeURIComponent(s.email.toLowerCase())}`}
                      className="text-ops-blue font-medium hover:underline"
                    >
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
                      <Check
                        role="img"
                        className="mx-auto h-4 w-4 text-green-600"
                        aria-label="High cycle"
                      />
                    ) : (
                      <span className="text-ops-gray-lighter" aria-hidden="true">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/staff/${encodeURIComponent(s.email.toLowerCase())}`}>
                        View observations
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageHeader>
  );
}
