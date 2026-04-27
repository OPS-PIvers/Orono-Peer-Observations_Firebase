import { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_YEARS,
  type Role,
  type RoleYearMapping,
  type Rubric,
  type StaffYear,
  flattenRubricComponentIds,
  roleYearMappingDocId,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const YEAR_LABELS: Record<StaffYear, string> = {
  1: 'Y1',
  2: 'Y2',
  3: 'Y3',
  4: 'P1',
  5: 'P2',
  6: 'P3',
};

export function RoleYearMappingsPage() {
  const { data: roles, loading: rolesLoading } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: rubrics, loading: rubricsLoading } = useFirestoreCollection<Rubric>(
    COLLECTIONS.rubrics,
  );
  const { data: mappings, loading: mappingsLoading } = useFirestoreCollection<RoleYearMapping>(
    COLLECTIONS.roleYearMappings,
  );

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Local override of the assignedComponentIds for the selected role —
  // keyed on year. Initialized from Firestore data; toggling a cell
  // mutates this until Save flushes back.
  const [draft, setDraft] = useState<Map<StaffYear, Set<string>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Auto-select first active role on load.
  useEffect(() => {
    if (!selectedRoleId && roles && roles.length > 0) {
      const firstActive = roles.find((r) => r.isActive) ?? roles[0];
      if (firstActive) setSelectedRoleId(firstActive.id);
    }
  }, [roles, selectedRoleId]);

  // Build/refresh draft whenever the selection changes or upstream data
  // arrives. Avoid clobbering an in-progress edit by skipping when dirty.
  useEffect(() => {
    if (!selectedRoleId || !mappings) return;
    if (dirty) return;
    const role = roles?.find((r) => r.id === selectedRoleId);
    if (!role) return;
    const next = new Map<StaffYear, Set<string>>();
    for (const year of OBSERVATION_YEARS) {
      const docId = roleYearMappingDocId(role.roleId, year);
      const existing = mappings.find((m) => m.id === docId);
      next.set(year, new Set(existing?.assignedComponentIds ?? []));
    }
    setDraft(next);
  }, [selectedRoleId, mappings, roles, dirty]);

  const selectedRole = roles?.find((r) => r.id === selectedRoleId);
  const selectedRubric = useMemo(
    () => (selectedRole ? rubrics?.find((r) => r.id === selectedRole.rubricId) : null),
    [rubrics, selectedRole],
  );

  function toggle(year: StaffYear, componentId: string) {
    if (!draft) return;
    const next = new Map(draft);
    const set = new Set(next.get(year) ?? []);
    if (set.has(componentId)) set.delete(componentId);
    else set.add(componentId);
    next.set(year, set);
    setDraft(next);
    setDirty(true);
  }

  function toggleColumn(year: StaffYear, allIds: string[]) {
    if (!draft) return;
    const set = new Set(draft.get(year) ?? []);
    const allChecked = allIds.every((id) => set.has(id));
    const next = new Map(draft);
    next.set(year, allChecked ? new Set() : new Set(allIds));
    setDraft(next);
    setDirty(true);
  }

  function toggleRow(componentId: string) {
    if (!draft) return;
    const allYearsChecked = OBSERVATION_YEARS.every((y) => draft.get(y)?.has(componentId));
    const next = new Map(draft);
    for (const year of OBSERVATION_YEARS) {
      const set = new Set(next.get(year) ?? []);
      if (allYearsChecked) set.delete(componentId);
      else set.add(componentId);
      next.set(year, set);
    }
    setDraft(next);
    setDirty(true);
  }

  async function save() {
    if (!draft || !selectedRole) return;
    setSaving(true);
    setSaveError(null);
    try {
      const batch = writeBatch(db);
      for (const year of OBSERVATION_YEARS) {
        const docId = roleYearMappingDocId(selectedRole.roleId, year);
        const ids = Array.from(draft.get(year) ?? []).sort();
        batch.set(
          doc(db, `${COLLECTIONS.roleYearMappings}/${docId}`),
          {
            roleId: selectedRole.roleId,
            year,
            assignedComponentIds: ids,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }
      await batch.commit();
      setSavedAt(new Date());
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const loading = rolesLoading || rubricsLoading || mappingsLoading;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Role / Year Mappings</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            For each role-year combination, choose which rubric components are evaluated. Replaces
            the legacy Settings sheet&apos;s 4-row-per-role block layout.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt ? (
            <span className="text-muted-foreground text-xs">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          ) : null}
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save mappings'}
          </Button>
        </div>
      </header>

      <div className="mb-6 max-w-md">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Role</span>
          <select
            value={selectedRoleId ?? ''}
            onChange={(e) => {
              if (dirty && !confirm('Discard unsaved mapping changes?')) return;
              setDirty(false);
              setSelectedRoleId(e.target.value);
            }}
            className="border-input bg-background h-11 rounded-md border px-3"
          >
            <option value="" disabled>
              {loading ? 'Loading…' : 'Select a role'}
            </option>
            {roles
              ?.slice()
              .sort((a, b) => a.displayName.localeCompare(b.displayName))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.displayName}
                  {r.isActive ? '' : ' (inactive)'}
                </option>
              ))}
          </select>
        </label>
      </div>

      {saveError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          {saveError}
        </div>
      ) : null}

      {!selectedRole ? (
        <p className="text-muted-foreground">Select a role above to edit its mappings.</p>
      ) : !selectedRubric ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
          Role <strong>{selectedRole.displayName}</strong> references rubric ID{' '}
          <code>{selectedRole.rubricId}</code> but that rubric doesn&apos;t exist. Open the Rubrics
          admin to create it.
        </div>
      ) : !draft ? (
        <p className="text-muted-foreground">Loading mappings…</p>
      ) : (
        <MatrixTable
          rubric={selectedRubric}
          draft={draft}
          onToggle={toggle}
          onToggleColumn={toggleColumn}
          onToggleRow={toggleRow}
        />
      )}
    </div>
  );
}

interface MatrixTableProps {
  rubric: Rubric;
  draft: Map<StaffYear, Set<string>>;
  onToggle: (year: StaffYear, componentId: string) => void;
  onToggleColumn: (year: StaffYear, allIds: string[]) => void;
  onToggleRow: (componentId: string) => void;
}

function MatrixTable({ rubric, draft, onToggle, onToggleColumn, onToggleRow }: MatrixTableProps) {
  const allIds = useMemo(() => flattenRubricComponentIds(rubric), [rubric]);
  return (
    <div className="border-border bg-background overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="bg-muted sticky left-0 px-3 py-2 text-left font-medium">Component</th>
            {OBSERVATION_YEARS.map((year) => {
              const set = draft.get(year) ?? new Set<string>();
              const allChecked = allIds.length > 0 && allIds.every((id) => set.has(id));
              return (
                <th key={year} className="px-3 py-2 text-center font-medium">
                  <div>{YEAR_LABELS[year]}</div>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-primary mt-1 text-[10px] uppercase"
                    onClick={() => onToggleColumn(year, allIds)}
                  >
                    {allChecked ? 'clear' : 'all'}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rubric.domains.map((domain) => (
            <DomainRows
              key={domain.id}
              domain={domain}
              draft={draft}
              onToggle={onToggle}
              onToggleRow={onToggleRow}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DomainRows({
  domain,
  draft,
  onToggle,
  onToggleRow,
}: {
  domain: Rubric['domains'][number];
  draft: Map<StaffYear, Set<string>>;
  onToggle: (year: StaffYear, componentId: string) => void;
  onToggleRow: (componentId: string) => void;
}) {
  return (
    <>
      <tr className="bg-accent/40">
        <td colSpan={OBSERVATION_YEARS.length + 1} className="px-3 py-1.5 text-xs font-medium">
          Domain {domain.id}: {domain.name}
        </td>
      </tr>
      {domain.components.map((c) => (
        <tr key={c.id} className="border-border border-t">
          <td className="bg-background sticky left-0 px-3 py-1.5">
            <button
              type="button"
              onClick={() => onToggleRow(c.id)}
              className="hover:text-primary text-left"
            >
              <span className="font-mono text-xs opacity-70">{c.id}</span> {c.title}
            </button>
          </td>
          {OBSERVATION_YEARS.map((year) => {
            const checked = draft.get(year)?.has(c.id) ?? false;
            return (
              <td key={year} className="px-3 py-1.5 text-center">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(year, c.id)}
                  className={cn('h-4 w-4', checked && 'accent-primary')}
                  aria-label={`${c.id} year ${YEAR_LABELS[year]}`}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
