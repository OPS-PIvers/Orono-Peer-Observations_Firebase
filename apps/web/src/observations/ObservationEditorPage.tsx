import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  PROFICIENCY_LEVELS,
  type Observation,
  type ObservationComponentEntry,
  type ProficiencyLevel,
  type Role,
  type RoleYearMapping,
  type Rubric,
  type RubricComponent,
  type RubricDomain,
  roleYearMappingDocId,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  developing: 'Developing',
  basic: 'Basic',
  proficient: 'Proficient',
  distinguished: 'Distinguished',
};

const AUTOSAVE_DEBOUNCE_MS = 800;

type ComponentEntries = Record<string, ObservationComponentEntry>;

export function ObservationEditorPage() {
  const { observationId } = useParams<{ observationId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const {
    data: observation,
    loading,
    error,
  } = useFirestoreDoc<Observation>(`${COLLECTIONS.observations}/${observationId ?? ''}`);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: rubrics } = useFirestoreCollection<Rubric>(COLLECTIONS.rubrics);

  // Derive rubric for this observation (looked up via the observed role's
  // displayName → role doc → rubricId).
  const rubric = useMemo<Rubric | null>(() => {
    if (!observation || !roles || !rubrics) return null;
    const role = roles.find((r) => r.displayName === observation.observedRole);
    if (!role) return null;
    return rubrics.find((rb) => rb.id === role.rubricId) ?? null;
  }, [observation, roles, rubrics]);

  const mappingPath = observation
    ? (() => {
        const role = roles?.find((r) => r.displayName === observation.observedRole);
        if (!role) return null;
        return `${COLLECTIONS.roleYearMappings}/${roleYearMappingDocId(role.roleId, observation.observedYear)}`;
      })()
    : null;
  const { data: mapping } = useFirestoreDoc<RoleYearMapping>(mappingPath ?? '');

  // Components active for this role-year combo, in display order from the
  // rubric. If no mapping exists, show ALL components from the rubric.
  const activeComponents: { domain: RubricDomain; component: RubricComponent }[] = useMemo(() => {
    if (!rubric) return [];
    const allow = mapping ? new Set(mapping.assignedComponentIds) : null;
    const out: { domain: RubricDomain; component: RubricComponent }[] = [];
    for (const d of rubric.domains) {
      for (const c of d.components) {
        if (!allow || allow.has(c.id)) {
          out.push({ domain: d, component: c });
        }
      }
    }
    return out;
  }, [rubric, mapping]);

  // Local draft of observationData; flushed to Firestore on debounce.
  const [draft, setDraft] = useState<ComponentEntries>({});
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef<ComponentEntries>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (observation) {
      setDraft(observation.observationData);
      draftRef.current = observation.observationData;
    }
  }, [observation]);

  useEffect(() => {
    // Auto-select the first active component when the rubric loads.
    if (selectedComponentId === null && activeComponents.length > 0) {
      setSelectedComponentId(activeComponents[0]?.component.id ?? null);
    }
  }, [activeComponents, selectedComponentId]);

  const flush = useCallback(async () => {
    if (!observation) return;
    setSavingState('saving');
    setSaveError(null);
    try {
      await setDoc(
        doc(db, `${COLLECTIONS.observations}/${observation.id}`),
        {
          observationData: draftRef.current,
          lastModifiedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setSavingState('saved');
    } catch (err) {
      setSavingState('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, [observation]);

  const scheduleSave = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    setSavingState('saving');
    flushTimer.current = setTimeout(() => {
      void flush();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  // Flush any pending save on unmount.
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        void flush();
      }
    };
  }, [flush]);

  const isReadOnly = observation?.status === OBSERVATION_STATUS.finalized;
  const isObserver = observation?.observerEmail === user?.email?.toLowerCase();
  const canEdit = !isReadOnly && isObserver;

  if (!observationId) {
    return <div className="text-destructive">No observation ID in URL.</div>;
  }
  if (loading && !observation) return <p className="text-muted-foreground">Loading…</p>;
  if (error)
    return (
      <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
        Failed to load observation: {error.message}
      </div>
    );
  if (!observation)
    return (
      <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
        Observation not found, or you don&apos;t have permission to view it.
      </div>
    );

  function update(componentId: string, patch: Partial<ObservationComponentEntry>) {
    if (!canEdit) return;
    const existing: ObservationComponentEntry = draftRef.current[componentId] ?? {
      proficiency: null,
      selectedLookForIds: [],
      scratchNotes: '',
    };
    const next = { ...draftRef.current, [componentId]: { ...existing, ...patch } };
    draftRef.current = next;
    setDraft(next);
    scheduleSave();
  }

  function toggleLookFor(componentId: string, lookForId: string) {
    if (!canEdit) return;
    const existing: ObservationComponentEntry = draftRef.current[componentId] ?? {
      proficiency: null,
      selectedLookForIds: [],
      scratchNotes: '',
    };
    const set = new Set(existing.selectedLookForIds);
    if (set.has(lookForId)) set.delete(lookForId);
    else set.add(lookForId);
    update(componentId, { selectedLookForIds: Array.from(set) });
  }

  const selected = activeComponents.find((ac) => ac.component.id === selectedComponentId);

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="mb-2">
            <ChevronLeft className="h-4 w-4" />
            Observations
          </Button>
          <h1 className="text-3xl font-bold">{observation.observedName}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {observation.observedRole} · Year {String(observation.observedYear)} ·{' '}
            {observation.type}
            {observation.observationName ? ` · ${observation.observationName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SaveStatusIndicator state={savingState} error={saveError} />
          <StatusBadge status={observation.status} />
        </div>
      </header>

      {!canEdit && !isReadOnly ? (
        <div className="bg-accent text-accent-foreground border-primary mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          You can view this observation but not edit it (you&apos;re not the observer).
        </div>
      ) : null}
      {isReadOnly ? (
        <div className="bg-accent text-accent-foreground border-primary mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          This observation is finalized and read-only.
        </div>
      ) : null}

      {!rubric ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Couldn&apos;t find a rubric for role <strong>{observation.observedRole}</strong>. Ask an
          admin to verify the role and rubric setup.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          <ComponentNav
            activeComponents={activeComponents}
            selectedComponentId={selectedComponentId}
            onSelect={setSelectedComponentId}
            entries={draft}
          />

          {selected ? (
            <ComponentEditor
              key={selected.component.id}
              domain={selected.domain}
              component={selected.component}
              entry={
                draft[selected.component.id] ?? {
                  proficiency: null,
                  selectedLookForIds: [],
                  scratchNotes: '',
                }
              }
              readOnly={!canEdit}
              onProficiency={(p) => update(selected.component.id, { proficiency: p })}
              onToggleLookFor={(id) => toggleLookFor(selected.component.id, id)}
              onNotes={(notes) => update(selected.component.id, { scratchNotes: notes })}
            />
          ) : (
            <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
              {activeComponents.length === 0
                ? 'No components are assigned for this role/year combination. Ask an admin to update the role/year mappings.'
                : 'Select a component on the left to start filling it in.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SaveStatusIndicator({
  state,
  error,
}: {
  state: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
}) {
  if (state === 'saving') {
    return <span className="text-muted-foreground text-xs">Saving…</span>;
  }
  if (state === 'saved') {
    return <span className="text-muted-foreground text-xs">All changes saved</span>;
  }
  if (state === 'error') {
    return <span className="text-destructive text-xs">Save failed: {error}</span>;
  }
  return null;
}

function StatusBadge({ status }: { status: Observation['status'] }) {
  if (status === OBSERVATION_STATUS.draft) {
    return (
      <span className="bg-muted text-muted-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
        Draft
      </span>
    );
  }
  return (
    <span className="bg-accent text-accent-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
      Finalized
    </span>
  );
}

function ComponentNav({
  activeComponents,
  selectedComponentId,
  onSelect,
  entries,
}: {
  activeComponents: { domain: RubricDomain; component: RubricComponent }[];
  selectedComponentId: string | null;
  onSelect: (id: string) => void;
  entries: ComponentEntries;
}) {
  // Group by domain for visual separation
  const grouped = new Map<string, { domain: RubricDomain; components: RubricComponent[] }>();
  for (const { domain, component } of activeComponents) {
    let g = grouped.get(domain.id);
    if (!g) {
      g = { domain, components: [] };
      grouped.set(domain.id, g);
    }
    g.components.push(component);
  }

  return (
    <aside className="border-border bg-background sticky top-4 h-fit max-h-[calc(100vh-160px)] overflow-y-auto rounded-lg border p-3">
      {Array.from(grouped.values()).map(({ domain, components }) => (
        <div key={domain.id} className="mb-3">
          <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            Domain {domain.id}: {domain.name}
          </h3>
          <ul className="space-y-1">
            {components.map((c) => {
              const entry = entries[c.id];
              const filled = entry?.proficiency !== null && entry?.proficiency !== undefined;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                      selectedComponentId === c.id
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <span className="font-mono text-xs opacity-70">{c.id}</span>{' '}
                    <span>{c.title}</span>
                    {filled ? (
                      <span
                        className={cn(
                          'ml-1 inline-block h-1.5 w-1.5 rounded-full',
                          selectedComponentId === c.id ? 'bg-primary-foreground' : 'bg-primary',
                        )}
                        aria-label="Filled"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}

interface ComponentEditorProps {
  domain: RubricDomain;
  component: RubricComponent;
  entry: ObservationComponentEntry;
  readOnly: boolean;
  onProficiency: (level: ProficiencyLevel | null) => void;
  onToggleLookFor: (lookForId: string) => void;
  onNotes: (notes: string) => void;
}

function ComponentEditor({
  domain,
  component,
  entry,
  readOnly,
  onProficiency,
  onToggleLookFor,
  onNotes,
}: ComponentEditorProps) {
  return (
    <section className="border-border bg-background space-y-6 rounded-lg border p-6">
      <header>
        <p className="text-muted-foreground text-xs">
          Domain {domain.id}: {domain.name}
        </p>
        <h2 className="font-heading mt-1 text-xl font-semibold">
          <span className="text-muted-foreground font-mono text-base">{component.id}</span>{' '}
          {component.title}
        </h2>
      </header>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Proficiency</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {PROFICIENCY_LEVELS.map((level) => {
            const checked = entry.proficiency === level;
            return (
              <label
                key={level}
                className={cn(
                  'border-input flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors',
                  checked && 'border-primary bg-accent',
                  readOnly && 'cursor-not-allowed opacity-70',
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`proficiency-${component.id}`}
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => onProficiency(level)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium">{PROFICIENCY_LABELS[level]}</span>
                </div>
                <p className="text-muted-foreground line-clamp-3 text-xs">
                  {component.proficiencyLevels[level] || (
                    <em className="opacity-60">No descriptor set</em>
                  )}
                </p>
              </label>
            );
          })}
        </div>
        {entry.proficiency ? (
          <button
            type="button"
            onClick={() => onProficiency(null)}
            disabled={readOnly}
            className="text-muted-foreground hover:text-destructive text-xs"
          >
            Clear selection
          </button>
        ) : null}
      </fieldset>

      {component.lookFors.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Look-fors</legend>
          <ul className="space-y-1">
            {component.lookFors.map((lf) => (
              <li key={lf.id}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={entry.selectedLookForIds.includes(lf.id)}
                    disabled={readOnly}
                    onChange={() => onToggleLookFor(lf.id)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>{lf.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {component.bestPractices ? (
        <details className="border-border rounded-md border">
          <summary className="bg-muted text-muted-foreground cursor-pointer rounded-t-md px-3 py-2 text-sm font-medium">
            Best practices reference
          </summary>
          <p className="text-muted-foreground px-3 py-2 text-sm whitespace-pre-line">
            {component.bestPractices}
          </p>
        </details>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={`notes-${component.id}`}>Notes</Label>
        <Textarea
          id={`notes-${component.id}`}
          value={entry.scratchNotes}
          onChange={(e) => onNotes(e.target.value)}
          rows={6}
          disabled={readOnly}
          placeholder="Quick scratch notes for this component. Rich-text per-component notes ship in Phase 5."
        />
      </div>
    </section>
  );
}
