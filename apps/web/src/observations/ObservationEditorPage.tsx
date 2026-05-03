import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ExternalLink, Loader2 } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  type Observation,
  type ObservationComponentEntry,
  type Role,
  type RoleYearMapping,
  type Rubric,
  type RubricComponent,
  type RubricDomain,
  type TiptapDoc,
  roleYearMappingDocId,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db, functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSidebarWidth } from '@/hooks/useSidebarWidth';
import { RubricGrid } from '@/components/rubric';
import { ScriptEditor } from './ScriptEditor';
import { GlobalToolsBar } from './GlobalToolsBar';
import { ScriptDrawer } from './ScriptDrawer';
import { MeetingNotesSection } from './MeetingNotesSection';
import { WorkProductResponseViewer } from './WorkProductResponseViewer';

interface FinalizeResponse {
  pdfDriveFileId: string;
  driveFolderId: string;
  pdfWebViewLink: string;
}

const finalizeObservationFn = httpsCallable<{ observationId: string }, FinalizeResponse>(
  functions,
  'finalizeObservation',
);

const AUTOSAVE_DEBOUNCE_MS = 800;

type ComponentEntries = Record<string, ObservationComponentEntry>;
type ComponentNotes = Record<string, TiptapDoc>;
interface EditorDraft {
  observationData: ComponentEntries;
  componentNotes: ComponentNotes;
  scriptDoc: TiptapDoc | undefined;
  preObsDate: Date | undefined;
  preObsNotes: TiptapDoc | undefined;
  postObsDate: Date | undefined;
  postObsNotes: TiptapDoc | undefined;
}

export function ObservationEditorPage() {
  const { observationId } = useParams<{ observationId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const sidebarWidth = useSidebarWidth();

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

  // Components active for this role-year combo. If no mapping exists, fall
  // back to ALL components from the rubric (matches the previous behavior
  // — admins surface mapping issues separately in the role-year settings).
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

  const assignedComponentIds = useMemo(
    () => new Set(activeComponents.map((ac) => ac.component.id)),
    [activeComponents],
  );

  // Build a filtered rubric so the matrix only renders rows the observed
  // staff member is actually evaluated on for this role-year.
  const visibleRubric = useMemo<Rubric | null>(() => {
    if (!rubric) return null;
    const filteredDomains = rubric.domains
      .map((d) => ({
        ...d,
        components: d.components.filter((c) => assignedComponentIds.has(c.id)),
      }))
      .filter((d) => d.components.length > 0);
    return { ...rubric, domains: filteredDomains };
  }, [rubric, assignedComponentIds]);

  // Local draft of observationData + componentNotes; flushed to Firestore
  // on debounce. Both fields share the same autosave cycle so we don't
  // have two timers racing against each other.
  const emptyDraft: EditorDraft = {
    observationData: {},
    componentNotes: {},
    scriptDoc: undefined,
    preObsDate: undefined,
    preObsNotes: undefined,
    postObsDate: undefined,
    postObsNotes: undefined,
  };
  const [draft, setDraft] = useState<EditorDraft>(emptyDraft);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef<EditorDraft>(emptyDraft);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [justFinalized, setJustFinalized] = useState<FinalizeResponse | null>(null);

  // Hydrate the local draft exactly once per observation. Subsequent
  // snapshots (including the user's own write coming back) must not touch
  // local state, or they'd overwrite keystrokes typed during the autosave
  // round-trip. Key off the loaded doc's own id rather than the URL
  // param, so a route change to a new observation can't briefly hydrate
  // with the previous observation's data while useFirestoreDoc is still
  // resubscribing. See issue #3.
  useHydratedDraft(observation?.id ?? null, observation, (src) => {
    const next: EditorDraft = {
      observationData: src.observationData,
      componentNotes: src.componentNotes,
      scriptDoc: src.scriptDoc,
      preObsDate: src.preObsDate,
      preObsNotes: src.preObsNotes,
      postObsDate: src.postObsDate,
      postObsNotes: src.postObsNotes,
    };
    setDraft(next);
    draftRef.current = next;
  });

  const flush = useCallback(async () => {
    if (!observation) return;
    setSavingState('saving');
    setSaveError(null);
    try {
      await setDoc(
        doc(db, `${COLLECTIONS.observations}/${observation.id}`),
        {
          observationData: draftRef.current.observationData,
          componentNotes: draftRef.current.componentNotes,
          scriptDoc: draftRef.current.scriptDoc ?? null,
          preObsDate: draftRef.current.preObsDate ?? null,
          preObsNotes: draftRef.current.preObsNotes ?? null,
          postObsDate: draftRef.current.postObsDate ?? null,
          postObsNotes: draftRef.current.postObsNotes ?? null,
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

  // KEEP the lowercase normalization — observerEmail is stored lowercased
  // when the observation is created, but Firebase Auth's User#email reflects
  // the case the user typed. Without this, the 233 imported observations
  // would silently flip to read-only for their original observer.
  const isReadOnly = observation?.status === OBSERVATION_STATUS.finalized;
  const isObserver = observation?.observerEmail === user?.email?.toLowerCase();
  const canEdit = !isReadOnly && isObserver;

  const updateEntry = useCallback(
    (componentId: string, patch: Partial<ObservationComponentEntry>) => {
      if (!canEdit) return;
      const existing: ObservationComponentEntry = draftRef.current.observationData[componentId] ?? {
        proficiency: null,
        selectedLookForIds: [],
        scratchNotes: '',
      };
      const nextEntries: ComponentEntries = {
        ...draftRef.current.observationData,
        [componentId]: { ...existing, ...patch },
      };
      const next: EditorDraft = { ...draftRef.current, observationData: nextEntries };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  const toggleLookFor = useCallback(
    (componentId: string, lookForId: string) => {
      if (!canEdit) return;
      const existing: ObservationComponentEntry = draftRef.current.observationData[componentId] ?? {
        proficiency: null,
        selectedLookForIds: [],
        scratchNotes: '',
      };
      const set = new Set(existing.selectedLookForIds);
      if (set.has(lookForId)) set.delete(lookForId);
      else set.add(lookForId);
      updateEntry(componentId, { selectedLookForIds: Array.from(set) });
    },
    [canEdit, updateEntry],
  );

  const setNotesDoc = useCallback(
    (componentId: string, document: TiptapDoc) => {
      if (!canEdit) return;
      const nextNotes: ComponentNotes = {
        ...draftRef.current.componentNotes,
        [componentId]: document,
      };
      const next: EditorDraft = { ...draftRef.current, componentNotes: nextNotes };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  const setScriptDoc = useCallback(
    (document: TiptapDoc) => {
      if (!canEdit) return;
      const next: EditorDraft = { ...draftRef.current, scriptDoc: document };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  const setPreObsDate = useCallback(
    (date: Date | undefined) => {
      if (!canEdit) return;
      const next: EditorDraft = { ...draftRef.current, preObsDate: date };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  const setPreObsNotes = useCallback(
    (doc: TiptapDoc) => {
      if (!canEdit) return;
      const next: EditorDraft = { ...draftRef.current, preObsNotes: doc };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  const setPostObsDate = useCallback(
    (date: Date | undefined) => {
      if (!canEdit) return;
      const next: EditorDraft = { ...draftRef.current, postObsDate: date };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  const setPostObsNotes = useCallback(
    (doc: TiptapDoc) => {
      if (!canEdit) return;
      const next: EditorDraft = { ...draftRef.current, postObsNotes: doc };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  async function handleFinalize() {
    if (!observation) return;
    setFinalizing(true);
    setFinalizeError(null);
    try {
      // Flush any in-flight edits first so the server sees current state.
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      await flush();
      const result = await finalizeObservationFn({ observationId: observation.id });
      setJustFinalized(result.data);
      setFinalizeOpen(false);
    } catch (err) {
      setFinalizeError(err instanceof Error ? err.message : 'Finalize failed');
    } finally {
      setFinalizing(false);
    }
  }

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

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (observation.observedEmail) {
                void navigate(`/staff/${observation.observedEmail}`);
              } else {
                void navigate(-1);
              }
            }}
            className="mb-2"
          >
            <ChevronLeft className="h-4 w-4" />
            {observation.observedName ? `← Back to ${observation.observedName}` : '← Back'}
          </Button>
          <h1 className="text-3xl font-bold">{observation.observedName}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {observation.observedRole} · Year {String(observation.observedYear)} ·{' '}
            {observation.type}
            {observation.observationName ? ` · ${observation.observationName}` : ''}
          </p>
        </div>
      </header>

      {justFinalized ? (
        <FinalizedBanner result={justFinalized} observedEmail={observation.observedEmail} />
      ) : null}

      <FinalizeDialog
        open={finalizeOpen}
        onOpenChange={(open) => {
          if (!finalizing) setFinalizeOpen(open);
        }}
        observation={observation}
        finalizing={finalizing}
        error={finalizeError}
        onConfirm={() => void handleFinalize()}
      />

      {!canEdit && !isReadOnly ? (
        <div className="bg-accent text-accent-foreground border-primary rounded-md border-l-4 px-3 py-2 text-sm">
          You can view this observation but not edit it (you&apos;re not the observer).
        </div>
      ) : null}
      {isReadOnly ? (
        <div className="bg-accent text-accent-foreground border-primary rounded-md border-l-4 px-3 py-2 text-sm">
          This observation is finalized and read-only.
        </div>
      ) : null}

      <MeetingNotesSection
        preObsDate={draft.preObsDate}
        preObsNotes={draft.preObsNotes}
        postObsDate={draft.postObsDate}
        postObsNotes={draft.postObsNotes}
        readOnly={!canEdit}
        onPreObsDateChange={setPreObsDate}
        onPreObsNotesChange={setPreObsNotes}
        onPostObsDateChange={setPostObsDate}
        onPostObsNotesChange={setPostObsNotes}
      />

      {observation.type === OBSERVATION_TYPES.workProduct ? (
        <WorkProductResponseViewer observation={observation} />
      ) : null}

      <GlobalToolsBar
        observation={observation}
        canEdit={canEdit}
        savingState={savingState}
        saveError={saveError}
        onFinalize={() => setFinalizeOpen(true)}
        rubric={visibleRubric}
      />

      {!visibleRubric ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
          Couldn&apos;t find a rubric for role <strong>{observation.observedRole}</strong>. Ask an
          admin to verify the role and rubric setup.
        </div>
      ) : visibleRubric.domains.length === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
          No components are assigned for this role/year combination. Ask an admin to update the
          role/year mappings.
        </div>
      ) : (
        <RubricGrid
          rubric={visibleRubric}
          mode={{
            kind: 'edit',
            entries: draft.observationData,
            notes: draft.componentNotes,
            readOnly: !canEdit,
            onProficiency: (componentId, proficiency) => updateEntry(componentId, { proficiency }),
            onToggleLookFor: toggleLookFor,
            onNotesChange: setNotesDoc,
          }}
          storageScope={`edit-${observation.id}`}
        />
      )}

      <ScriptDrawer sidebarWidth={sidebarWidth}>
        <ScriptEditor
          value={draft.scriptDoc}
          onChange={setScriptDoc}
          readOnly={!canEdit}
          availableComponents={activeComponents}
          placeholder="Start typing what you see and hear during the observation…"
          minHeight="16rem"
        />
      </ScriptDrawer>
    </div>
  );
}

function FinalizeDialog({
  open,
  onOpenChange,
  observation,
  finalizing,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  observation: Observation;
  finalizing: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finalize observation</DialogTitle>
          <DialogDescription>
            This will lock the observation, generate a PDF, and share the Drive folder with{' '}
            <strong>{observation.observedEmail}</strong> as Reader. After finalizing, no further
            edits are possible.
          </DialogDescription>
        </DialogHeader>
        <ul className="text-muted-foreground space-y-1 px-1 py-2 text-sm">
          <li>· Observed: {observation.observedName}</li>
          <li>· Type: {observation.type}</li>
          <li>
            · Audio recordings:{' '}
            {observation.audioDriveFileIds.length === 0
              ? 'none'
              : `${String(observation.audioDriveFileIds.length)} (will remain in the Drive folder)`}
          </li>
        </ul>
        {error ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={finalizing}
            type="button"
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={finalizing}>
            {finalizing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Finalizing…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Finalize
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinalizedBanner({
  result,
  observedEmail,
}: {
  result: FinalizeResponse;
  observedEmail: string;
}) {
  return (
    <div className="border-primary bg-accent text-accent-foreground rounded-md border-l-4 px-4 py-3">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="text-primary mt-0.5 h-5 w-5 flex-shrink-0" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Observation finalized.</p>
          <p>
            The Drive folder has been shared with <strong>{observedEmail}</strong> as Reader.
            They&apos;ll see the observation when they sign in.
          </p>
          <div className="flex flex-wrap gap-3 pt-1 text-xs">
            <a
              href={result.pdfWebViewLink}
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex items-center gap-1 underline hover:no-underline"
            >
              Open PDF <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={`https://drive.google.com/drive/folders/${result.driveFolderId}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary inline-flex items-center gap-1 underline hover:no-underline"
            >
              Open Drive folder <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
