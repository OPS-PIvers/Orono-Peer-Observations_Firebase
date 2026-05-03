import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';
import { COLLECTIONS, type Staff } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
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

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [buildingFilter, setBuildingFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [selected, setSelected] = useState<(Staff & { id: string }) | null>(null);

  // Distinct values for the filter dropdowns
  const distinctRoles = useMemo(() => {
    const set = new Set<string>();
    staff?.forEach((s) => set.add(s.role));
    return Array.from(set).sort();
  }, [staff]);
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
        const matches =
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.role.toLowerCase().includes(q) ||
          s.buildings.some((b) => b.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });
  }, [staff, search, roleFilter, yearFilter, buildingFilter, activeOnly]);

  return (
    <div>
      <header className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-2">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-3xl font-bold">New observation</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick the staff member you&apos;re observing.{' '}
          {staff
            ? `${String(filtered.length)} of ${String(staff.length)} match.`
            : 'Loading staff…'}
        </p>
      </header>

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
            <option key={r} value={r}>
              {r}
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
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  Loading…
                </TableCell>
              </TableRow>
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
                  <TableCell>{s.role}</TableCell>
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
    </div>
  );
}
