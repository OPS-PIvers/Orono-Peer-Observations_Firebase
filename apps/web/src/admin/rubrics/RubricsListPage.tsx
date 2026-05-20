import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { COLLECTIONS, type Rubric } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import {
  AdminDataView,
  type AdminDataViewSort,
  type ColumnDef,
} from '@/admin/_shared/AdminDataView';
import { sortRows } from '@/admin/_shared/sortRows';

interface RubricRow extends Rubric {
  id: string;
  componentCount: number;
}

export function RubricsListPage() {
  const { data: rubrics, loading, error } = useFirestoreCollection<Rubric>(COLLECTIONS.rubrics);
  const [sort, setSort] = useState<AdminDataViewSort | null>({
    key: 'displayName',
    direction: 'asc',
  });

  const decorated: RubricRow[] = useMemo(
    () =>
      (rubrics ?? []).map((r) => ({
        ...r,
        componentCount: r.domains.reduce((sum, d) => sum + d.components.length, 0),
      })),
    [rubrics],
  );

  const columns: ColumnDef<RubricRow>[] = useMemo(
    () => [
      {
        key: 'displayName',
        header: 'Display name',
        cellClassName: 'font-medium',
        sortAccessor: (r) => r.displayName,
        cell: (r) => r.displayName,
        mobile: { primary: true },
      },
      {
        key: 'rubricId',
        header: 'Rubric ID',
        cellClassName: 'text-muted-foreground font-mono text-xs',
        sortAccessor: (r) => r.rubricId,
        cell: (r) => r.rubricId,
      },
      {
        key: 'domains',
        header: 'Domains',
        headClassName: 'w-24',
        sortAccessor: (r) => r.domains.length,
        cell: (r) => r.domains.length,
      },
      {
        key: 'components',
        header: 'Components',
        headClassName: 'w-28',
        sortAccessor: (r) => r.componentCount,
        cell: (r) => r.componentCount,
      },
    ],
    [],
  );

  const sorted = useMemo(() => sortRows(decorated, columns, sort), [decorated, columns, sort]);

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Rubrics']}
      title="Rubrics"
      subtitle="One rubric per role. Each rubric has 4 domains and a variable number of components with proficiency descriptors, best practices, and look-fors."
      actions={
        <Button asChild>
          <Link to="/admin/roles">
            <Plus />
            Add role
          </Link>
        </Button>
      }
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load rubrics: {error.message}
        </div>
      ) : null}

      <AdminDataView
        columns={columns}
        rows={loading && !rubrics ? null : sorted}
        loading={loading}
        rowKey={(r) => r.id}
        empty="No rubrics yet. Add a role to get started."
        sort={sort}
        onSortChange={setSort}
        rowActions={(r) => (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/admin/rubrics/${r.id}`}>Edit</Link>
          </Button>
        )}
      />
    </PageHeader>
  );
}
