import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { COLLECTIONS, type Rubric } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function RubricsListPage() {
  const { data: rubrics, loading, error } = useFirestoreCollection<Rubric>(COLLECTIONS.rubrics);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Rubrics</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            One rubric per role. Each rubric has 4 domains and a variable number of components with
            proficiency descriptors, best practices, and look-fors.
          </p>
        </div>
        <Button asChild>
          <Link to="/admin/roles">
            <Plus />
            Add role
          </Link>
        </Button>
      </header>

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load rubrics: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Display name</TableHead>
              <TableHead>Rubric ID</TableHead>
              <TableHead className="w-24">Domains</TableHead>
              <TableHead className="w-28">Components</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !rubrics ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : rubrics?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                  No rubrics yet. Add a role to get started.
                </TableCell>
              </TableRow>
            ) : (
              rubrics
                ?.slice()
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map((r) => {
                  const componentCount = r.domains.reduce((sum, d) => sum + d.components.length, 0);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.displayName}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {r.rubricId}
                      </TableCell>
                      <TableCell>{r.domains.length}</TableCell>
                      <TableCell>{componentCount}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/admin/rubrics/${r.id}`}>Edit</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
