import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ExternalLink, Info, Loader2 } from 'lucide-react';
import { toDateInputValue, parseDateInput } from '@/utils/dateHelpers';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  type DriveFileRef,
  type Observation,
  type ObservationComponentEntry,
  type ProficiencyLevel,
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
import { cn } from '@/lib/utils';
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
import { usePublishChromeHeight } from '@/hooks/usePublishChromeHeight';
import {
  AssignmentToggle,
  DomainNav,
  RubricGrid,
  type AssignmentMode,
  type RubricGridMode,
} from '@/components/rubric';
import { roleDisplayName } from '@/utils/roleLookup';
import { ScriptEditor } from './ScriptEditor';
import { ScriptDrawer } from './ScriptDrawer';
import { MeetingNotesSection } from './MeetingNotesSection';
import { WorkProductResponseViewer } from './WorkProductResponseViewer';
import { InstructionalRoundResponseViewer } from './InstructionalRoundResponseViewer';
import { AudioPopoverButton } from './AudioPopoverButton';
import { SaveStatusIndicator, StatusBadge } from './GlobalToolsBar';

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
  observationName: string;
  observationDate: Date | undefined;
}

const emptyDraft: EditorDraft = {
  observationData: {},
  componentNotes: {},
  scriptDoc: undefined,
  preObsDate: undefined,
  preObsNotes: undefined,
  postObsDate: undefined,
  postObsNotes: undefined,
  observationName: '',
  observationDate: undefined,
};

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

  // Derive rubric for this observation (looked up via the observed role
  // slug → role doc → rubricId).
  const rubric = useMemo<Rubric | null>(() => {
    if (!observation || !roles || !rubrics) return null;
    const role = roles.find((r) => r.roleId === observation.observedRole);
    if (!role) return null;
    return rubrics.find((rb) => rb.id === role.rubricId) ?? null;
  }, [observation, roles, rubrics]);

  const observedRoleLabel = roleDisplayName(roles, observation?.observedRole);

  const mappingPath = observation
    ? (() => {
        const role = roles?.find((r) => r.roleId === observation.observedRole);
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

  // The evaluator can flip between just the components assigned for
  // this role-year (default — what they're actually scoring) and the
  // full rubric (read-the-other-descriptors mode). Only the assigned
  // ones are persisted/scored regardless.
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('assigned');

  // Build a filtered rubric so the matrix only renders rows the observed
  // staff member is actually evaluated on for this role-year — unless
  // the toggle is set to "Full Rubric".
  const visibleRubric = useMemo<Rubric | null>(() => {
    if (!rubric) return null;
    if (assignmentMode === 'full') return rubric;
    const filteredDomains = rubric.domains
      .map((d) => ({
        ...d,
        components: d.components.filter((c) => assignedComponentIds.has(c.id)),
      }))
      .filter((d) => d.components.length > 0);
    return { ...rubric, domains: filteredDomains };
  }, [rubric, assignedComponentIds, assignmentMode]);

  // Local draft of observationData + componentNotes; flushed to Firestore
  // on debounce. Both fields share the same autosave cycle so we don't
  // have two timers racing against each other.
  const [draft, setDraft] = useState<EditorDraft>(emptyDraft);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef<EditorDraft>(emptyDraft);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [justFinalized, setJustFinalized] = useState<FinalizeResponse | null>(null);

  // Sticky chrome ref — `EditorChrome` consumes it via `usePublishChromeHeight`
  // so `DomainSection.tsx`'s `top-[var(--page-chrome-h)]` resolves correctly.
  const chromeRef = useRef<HTMLDivElement>(null);

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
      // Coerce Firestore Timestamps to JS Dates — MeetingNotesSection's
      // dateLabel calls .toLocaleDateString(), which throws on Timestamp
      // and re-throws each render under the route error boundary, looking
      // like an infinite render loop.
      preObsDate: toJsDate(src.preObsDate),
      preObsNotes: src.preObsNotes,
      postObsDate: toJsDate(src.postObsDate),
      postObsNotes: src.postObsNotes,
      observationName: src.observationName,
      observationDate: toJsDate(src.observationDate),
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
          observationName: draftRef.current.observationName,
          observationDate: draftRef.current.observationDate ?? null,
          lastModifiedAt: serverTimestamp(),
        },
        { merge: true },
      );
      // Don't claim "saved" if the user kept typing during the round-trip —
      // another flush is already queued, and flipping to 'saved' here would
      // briefly mislead them before the next 'saving' transition.
      if (flushTimer.current === null) {
        setSavingState('saved');
      }
    } catch (err) {
      setSavingState('error');
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, [observation]);

  // Debounce only — leave the visible indicator on its prior state ('saved'
  // or 'idle') during the wait. flush() itself flips to 'saving', and the
  // indicator defers rendering that label so fast writes don't flash.
  const scheduleSave = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
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
  const showFinalize = canEdit && observation?.status === OBSERVATION_STATUS.draft;

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

  const setObservationName = useCallback(
    (name: string) => {
      if (!canEdit) return;
      const next: EditorDraft = { ...draftRef.current, observationName: name };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  const setObservationDate = useCallback(
    (date: Date | undefined) => {
      if (!canEdit) return;
      const next: EditorDraft = { ...draftRef.current, observationDate: date };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, scheduleSave],
  );

  // Stable handler for proficiency selection so the rubric grid's memoized
  // edit-mode object (built in EditorRubricGrid) only changes when the data
  // it depends on changes — not on every parent render.
  const setProficiency = useCallback(
    (componentId: string, proficiency: ProficiencyLevel | null) => {
      updateEntry(componentId, { proficiency });
    },
    [updateEntry],
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

  // Body content wrapper — used by both the loading/error/not-found
  // branches and the main return so all variants align with the chrome's
  // inner content width.
  const bodyWrapperCls = 'mx-auto max-w-7xl px-4 py-6 md:px-6 space-y-4';

  if (!observationId) {
    return (
      <div className={bodyWrapperCls}>
        <div className="text-destructive">No observation ID in URL.</div>
      </div>
    );
  }
  if (loading && !observation)
    return (
      <div className={bodyWrapperCls}>
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  if (error)
    return (
      <div className={bodyWrapperCls}>
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
          Failed to load observation: {error.message}
        </div>
      </div>
    );
  if (!observation)
    return (
      <div className={bodyWrapperCls}>
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
          Observation not found, or you don&apos;t have permission to view it.
        </div>
      </div>
    );

  return (
    <>
      <div className={bodyWrapperCls}>
        <header className="space-y-2">
          {/* Title row: back arrow, observed name, info popover,
              status chip, save-state indicator. The row wraps when
              narrow so the name is never truncated — saving state can
              drop below on tight widths. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Back"
              onClick={() => {
                if (observation.observedEmail) {
                  void navigate(`/staff/${observation.observedEmail}`);
                } else {
                  void navigate(-1);
                }
              }}
              className="text-ops-blue hover:text-ops-blue-dark hover:bg-ops-blue-lighter/30 -ml-2 h-9 w-9 shrink-0 px-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="font-heading text-ops-blue-dark text-xl leading-tight font-semibold sm:text-2xl md:text-3xl">
              {observation.observedName}
            </h1>
            {/* Info + Draft chip + save state stay together as one
                inline group so "Saving…" never breaks onto its own
                line away from the Draft chip. */}
            <div className="inline-flex shrink-0 items-center gap-2">
              <ObservationInfoPopover
                role={observedRoleLabel}
                year={observation.observedYear}
                type={observation.type}
              />
              <StatusBadge status={observation.status} />
              <SaveStatusIndicator state={savingState} error={saveError} />
            </div>
          </div>
          {canEdit ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft.observationName}
                onChange={(e) => setObservationName(e.target.value)}
                placeholder="Observation name (e.g. Period 3 Algebra)"
                aria-label="Observation name"
                className="border-input focus:border-ops-blue focus:ring-ops-blue h-9 min-w-0 flex-1 rounded-md border bg-white px-3 text-sm outline-none focus:ring-1"
              />
              <input
                type="date"
                value={toDateInputValue(draft.observationDate)}
                onChange={(e) => setObservationDate(parseDateInput(e.target.value))}
                aria-label="Observation date"
                className="border-input focus:border-ops-blue focus:ring-ops-blue h-9 w-[10.5rem] shrink-0 rounded-md border bg-white px-3 text-sm outline-none focus:ring-1"
              />
            </div>
          ) : (
            <p className="text-ops-gray-dark text-sm">
              {[draft.observationName, draft.observationDate?.toLocaleDateString()]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </header>
      </div>

      <EditorToolbar
        chromeRef={chromeRef}
        observation={observation}
        canEdit={canEdit}
        rubric={visibleRubric}
        showFinalize={showFinalize}
        onFinalize={() => setFinalizeOpen(true)}
      />

      <div className={bodyWrapperCls}>
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
          <div className="bg-ops-blue-lighter border-l-ops-gray text-ops-gray-dark rounded-lg border-l-4 px-4 py-2.5 text-sm">
            You can view this observation but not edit it (you&apos;re not the observer).
          </div>
        ) : null}
        {isReadOnly ? (
          <div className="bg-ops-blue-lighter border-l-ops-blue text-ops-blue-dark rounded-lg border-l-4 px-4 py-2.5 text-sm">
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
          // Park the rubric scope toggle on the right of the meeting-
          // notes row at md+ so it sits inline with Planning/
          // Reflection. At mobile widths it drops below the row as a
          // full-width control.
          actions={
            <AssignmentToggle value={assignmentMode} onChange={setAssignmentMode} fullWidth />
          }
        />

        {observation.type === OBSERVATION_TYPES.workProduct ? (
          <WorkProductResponseViewer observation={observation} />
        ) : null}

        {observation.type === OBSERVATION_TYPES.instructionalRound ? (
          <InstructionalRoundResponseViewer observation={observation} />
        ) : null}

        {!visibleRubric ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
            Couldn&apos;t find a rubric for role <strong>{observedRoleLabel}</strong>. Ask an admin
            to verify the role and rubric setup.
          </div>
        ) : visibleRubric.domains.length === 0 ? (
          <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
            No components are assigned for this role/year combination. Ask an admin to update the
            role/year mappings.
          </div>
        ) : (
          <EditorRubricGrid
            rubric={visibleRubric}
            observationId={observation.id}
            entries={draft.observationData}
            notes={draft.componentNotes}
            scriptDoc={draft.scriptDoc}
            evidenceLinks={observation.evidenceLinks ?? {}}
            readOnly={!canEdit}
            onProficiency={setProficiency}
            onToggleLookFor={toggleLookFor}
            onNotesChange={setNotesDoc}
          />
        )}
      </div>

      <ScriptDrawer sidebarWidth={sidebarWidth}>
        <ScriptEditor
          value={draft.scriptDoc}
          onChange={setScriptDoc}
          readOnly={!canEdit}
          availableComponents={activeComponents}
          observationId={observation.id}
          placeholder="Start typing what you see and hear during the observation…"
        />
      </ScriptDrawer>
    </>
  );
}

interface EditorRubricGridProps {
  rubric: Rubric;
  observationId: string;
  entries: ComponentEntries;
  notes: ComponentNotes;
  scriptDoc: TiptapDoc | undefined;
  evidenceLinks: Record<string, DriveFileRef[]>;
  readOnly: boolean;
  onProficiency: (componentId: string, proficiency: ProficiencyLevel | null) => void;
  onToggleLookFor: (componentId: string, lookForId: string) => void;
  onNotesChange: (componentId: string, doc: TiptapDoc) => void;
}

/**
 * Builds the rubric grid's edit-mode object with a stable identity. The
 * callbacks arrive as props (already memoized in the parent), so this memo
 * only changes when the rubric data the rows render from changes — keeping
 * the memoized RubricRow from re-rendering on unrelated parent updates.
 */
function EditorRubricGrid({
  rubric,
  observationId,
  entries,
  notes,
  scriptDoc,
  evidenceLinks,
  readOnly,
  onProficiency,
  onToggleLookFor,
  onNotesChange,
}: EditorRubricGridProps) {
  const mode = useMemo<RubricGridMode>(
    () => ({
      kind: 'edit',
      entries,
      notes,
      ...(scriptDoc ? { scriptDoc } : {}),
      evidenceLinks,
      observationId,
      readOnly,
      onProficiency,
      onToggleLookFor,
      onNotesChange,
    }),
    [
      entries,
      notes,
      scriptDoc,
      evidenceLinks,
      observationId,
      readOnly,
      onProficiency,
      onToggleLookFor,
      onNotesChange,
    ],
  );
  return <RubricGrid rubric={rubric} mode={mode} storageScope={`edit-${observationId}`} />;
}

interface EditorToolbarProps {
  chromeRef: React.RefObject<HTMLDivElement | null>;
  observation: Observation & { id: string };
  canEdit: boolean;
  rubric: Rubric | null;
  showFinalize: boolean;
  onFinalize: () => void;
}

/**
 * Slim sticky toolbar for the observation editor. One row, never wraps:
 * the DomainNav jump-pills scroll horizontally on the left, the action
 * group (Audio + Finalize CTA) sits on the right. The page title +
 * status chip + save state + editable name/date inputs scroll with the
 * page above this — only the controls a user actually needs while
 * working through the rubric stay anchored.
 *
 * Publishes its measured height to `--page-chrome-h` so
 * `DomainSection.tsx`'s `top-[var(--page-chrome-h)]` sticky domain
 * titles offset cleanly below it (instead of underneath, which used to
 * make only the proficiency-level row appear sticky).
 */
function EditorToolbar({
  chromeRef,
  observation,
  canEdit,
  rubric,
  showFinalize,
  onFinalize,
}: EditorToolbarProps) {
  usePublishChromeHeight(chromeRef);
  const hasDomains = !!rubric && rubric.domains.length > 0;

  return (
    <div
      ref={chromeRef}
      className="border-ops-gray-lighter bg-ops-gray-lightest/95 supports-[backdrop-filter]:bg-ops-gray-lightest/85 sticky top-0 z-20 w-full border-y backdrop-blur"
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 md:px-6">
        <div className="-mx-1 flex min-w-0 flex-1 overflow-x-auto">
          {hasDomains ? (
            <div className="px-1">
              <DomainNav rubric={rubric} />
            </div>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canEdit ? (
            <AudioPopoverButton
              observationId={observation.id}
              audioFileIds={observation.audioDriveFileIds}
              transcripts={observation.transcripts}
              readOnly={!canEdit}
            />
          ) : null}
          {showFinalize ? (
            <Button
              onClick={onFinalize}
              size="sm"
              className="bg-ops-red hover:bg-ops-red-dark h-9 px-3 font-semibold text-white"
            >
              Finalize
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Small (i) button next to the observation title. On click it opens a
 * popover with the role / year / observation-type metadata that used
 * to live as a static second line under the title.
 */
function ObservationInfoPopover({
  role,
  year,
  type,
}: {
  role: string;
  year: number | string;
  type: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // "Standard" gets " Observation" appended for clarity; the other
  // two types ("Work Product", "Instructional Round") are already
  // self-describing.
  const typeLabel = type === 'Standard' ? 'Standard Observation' : type;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Show observation details"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full',
          'text-ops-gray hover:bg-ops-blue-lighter/40 hover:text-ops-blue-dark',
          open && 'bg-ops-blue-lighter/40 text-ops-blue-dark',
          'transition-colors',
        )}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Observation details"
          // Center the popover horizontally under the trigger so it
          // never gets cut off at either viewport edge. `max-w` clamps
          // the width on extremely narrow viewports.
          className="border-border bg-popover text-popover-foreground absolute top-full left-1/2 z-50 mt-2 w-56 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border p-3 text-sm shadow-lg"
        >
          <dl className="space-y-1">
            <div className="flex gap-1.5">
              <dt className="text-ops-gray w-12 shrink-0">Role</dt>
              <dd className="font-medium">{role}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-ops-gray w-12 shrink-0">Year</dt>
              <dd className="font-medium">{String(year)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-ops-gray w-12 shrink-0">Type</dt>
              <dd className="font-medium">{typeLabel}</dd>
            </div>
          </dl>
        </div>
      ) : null}
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
          <div
            role="alert"
            className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
          >
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

function toJsDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  const ts = value as { toDate?: () => Date } | null;
  if (ts != null && typeof ts.toDate === 'function') return ts.toDate();
  return undefined;
}
