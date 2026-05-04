import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { COLLECTIONS, isStaffYear, type Staff, type StaffYear } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StaffDialog } from './StaffDialog';

interface StaffRow extends Staff {
  id: string;
}

export function StaffPage() {
  const { data: staff, loading, error } = useFirestoreCollection<Staff>(COLLECTIONS.staff);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const filtered = useMemo(() => {
    if (!staff) return [];
    const q = search.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        s.buildings.some((b) => b.toLowerCase().includes(q)),
    );
  }, [staff, search]);

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle={
          staff ? `${String(filtered.length)} of ${String(staff.length)} staff` : 'Loading…'
        }
        actions={
          <Button
            onClick={() => setShowCreate(true)}
            className="text-ops-blue-dark bg-white hover:bg-white/90"
          >
            <Plus />
            Add staff
          </Button>
        }
      />

      <div className="mb-4 max-w-md">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, role, or building"
            className="pl-9"
          />
        </div>
      </div>

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
          Failed to load staff: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-16">Year</TableHead>
              <TableHead>Buildings</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !staff ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-6 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-6 text-center">
                  {search ? 'No staff match that search.' : 'No staff yet.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => setEditing(s)}
                  data-state={s.isActive ? undefined : 'inactive'}
                >
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.email}</TableCell>
                  <TableCell>{s.role}</TableCell>
                  <TableCell>{formatYear(s.year)}</TableCell>
                  <TableCell>
                    {s.buildings.join(', ') || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {s.isActive ? (
                      <span className="bg-accent text-accent-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
                        Active
                      </span>
                    ) : (
                      <span className="bg-muted text-muted-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
                        Inactive
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(s);
                      }}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <StaffDialog open={showCreate} onOpenChange={setShowCreate} mode="create" existing={null} />
      <StaffDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        mode="edit"
        existing={editing}
      />
    </>
  );
}

function formatYear(year: StaffYear): string {
  // Years 4-6 are probationary years P1, P2, P3 in the GAS schema.
  if (year === 4) return 'P1';
  if (year === 5) return 'P2';
  if (year === 6) return 'P3';
  return String(year);
}

export { isStaffYear };
