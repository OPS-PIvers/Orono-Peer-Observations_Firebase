import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';
import { COLLECTIONS, type Role, type Staff } from '@ops/shared';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { roleDisplayName } from '@/utils/roleLookup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CreateObservationDialog } from './CreateObservationDialog';

/**
 * Staff selector for starting a new observation.
 *
 * Filters: text search across name/email/role/buildings, role filter,
 * year filter, building filter, active-only toggle (default on).
 *
 * Clicking a staff member opens a confirm dialog where the PE picks the
 * observation type (Standard / Work Product / Instructional Round) and
 * optionally a name. Confirming creates the Firestore /observations/{id}
 * doc and routes to its editor.
 */
export function NewObservationPage() {
  const navigate = useNavigate();
  const { data: staff, loading } = useFirestoreCollection<Staff>(COLLECTIONS.staff);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [buildingFilter, setBuildingFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [selected, setSelected] = useState<(Staff & { id: string }) | null>(null);

  // Distinct values for the filter dropdowns. Role filter values are slugs;
  // include both configured roles and legacy free-text values present on
  // staff records so unmapped values stay selectable.
  const distinctRoles = useMemo(() => {
    const map = new Map<string, string>();
    roles?.forEach((r) => map.set(r.roleId, r.displayName));
    staff?.forEach((s) => {
      if (!map.has(s.role)) map.set(s.role, s.role);
    });
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [staff, roles]);
  const distinctBuildings = useMemo(() => {
    const set = new Set<string>();
    staff?.forEach((s) => s.buildings.forEach((b) => set.add(b)));
    return Array.from(set).sort();
  }, [staff]);

  const filtered = useMemo(() => {
    if (!staff) return [];
    const q = search.trim().toLowerCase();
    return staff.filter((s) => {
      if (activeOnly && !s.isActive) return false;
      if (roleFilter !== 'all' && s.role !== roleFilter) return false;
      if (yearFilter !== 'all' && String(s.year) !== yearFilter) return false;
      if (buildingFilter !== 'all' && !s.buildings.includes(buildingFilter)) return false;
      if (q) {
        const label = roleDisplayName(roles, s.role).toLowerCase();
        const matches =
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          label.includes(q) ||
          s.role.toLowerCase().includes(q) ||
          s.buildings.some((b) => b.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });
  }, [staff, roles, search, roleFilter, yearFilter, buildingFilter, activeOnly]);

  return (
    <PageHeader
      title="New observation"
      subtitle={`Pick the staff member you're observing.${
        staff ? ` ${String(filtered.length)} of ${String(staff.length)} match.` : ' Loading staff…'
      }`}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate('/observations/windows')}
            className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            Observation windows
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(-1)}
            className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, role, or building"
            className="pl-9"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="border-input bg-background h-11 rounded-md border px-3 text-sm"
        >
          <option value="all">All roles</option>
          {distinctRoles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="border-input bg-background h-11 rounded-md border px-3 text-sm"
        >
          <option value="all">All years</option>
          <option value="1">Year 1</option>
          <option value="2">Year 2</option>
          <option value="3">Year 3</option>
          <option value="4">P1</option>
          <option value="5">P2</option>
          <option value="6">P3</option>
        </select>
        <select
          value={buildingFilter}
          onChange={(e) => setBuildingFilter(e.target.value)}
          className="border-input bg-background h-11 rounded-md border px-3 text-sm"
        >
          <option value="all">All buildings</option>
          {distinctBuildings.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4"
          />
          Active only
        </label>
      </div>

      <div className="border-border bg-background overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-20">Year</TableHead>
              <TableHead>Buildings</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !staff ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={`skeleton-${String(i)}`}>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-7 w-20" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  No staff match those filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  role="button"
                  aria-label={`Observe ${s.name}`}
                  onClick={() => setSelected(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(s);
                    }
                  }}
                >
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.email}</TableCell>
                  <TableCell>{roleDisplayName(roles, s.role)}</TableCell>
                  <TableCell>
                    {s.year < 4 ? `Y${String(s.year)}` : `P${String(s.year - 3)}`}
                  </TableCell>
                  <TableCell className="text-sm">
                    {s.buildings.join(', ') || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(s);
                      }}
                    >
                      Observe
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selected ? (
        <CreateObservationDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          staff={selected}
          onCreated={(observationId) => {
            void navigate(`/observations/${observationId}`);
          }}
        />
      ) : null}
    </PageHeader>
  );
}
