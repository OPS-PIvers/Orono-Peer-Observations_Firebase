import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ExternalLink, Info, Loader2, RotateCcw } from 'lucide-react';
import { toDateInputValue, parseDateInput } from '@/utils/dateHelpers';
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
  type ReopenObservationInput,
  type RubricDomain,
  type SignupFieldAnswer,
  type TiptapDoc,
  roleYearMappingDocId,
} from '@ops/shared';
import { useAuth, useIsAdmin } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
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
import { Textarea } from '@/components/ui/textarea';
import { useSidebarWidth } from '@/hooks/useSidebarWidth';
import { usePublishChromeHeight } from '@/hooks/usePublishChromeHeight';
import { AssignmentToggle, DomainNav, RubricGrid, type AssignmentMode } from '@/components/rubric';
import { roleDisplayName } from '@/utils/roleLookup';
import { ScriptEditor } from './ScriptEditor';
import { ScriptDrawer } from './ScriptDrawer';
import { SignupDetailsCard } from './SignupDetailsCard';
import { SignupDetailsDisplay } from '@/scheduling/SignupDetailsDisplay';
import { MeetingNotesSection } from './MeetingNotesSection';
import { WorkProductResponseViewer } from './WorkProductResponseViewer';
import { InstructionalRoundResponseViewer } from './InstructionalRoundResponseViewer';
import { AudioPopoverButton } from './AudioPopoverButton';
import { appendTranscriptToScriptDoc } from './insert-transcript';
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

const reopenObservationFn = httpsCallable<ReopenObservationInput, { ok: boolean }>(
  functions,
  'reopenObservation',
);

const AUTOSAVE_DEBOUNCE_MS = 800;
// Automatic retry backoff after a save failure: 2s, 4s, 8s, 16s, capped at
// 30s, giving up automatic retries after AUTOSAVE_MAX_AUTO_RETRIES attempts
// (the manual "Retry" affordance in SaveStatusIndicator still works — and
// resets this counter — indefinitely after that).
const AUTOSAVE_RETRY_BASE_MS = 2000;
const AUTOSAVE_RETRY_MAX_MS = 30000;
const AUTOSAVE_MAX_AUTO_RETRIES = 5;

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
  const isAdminUser = useIsAdmin();
  const sidebarWidth = useSidebarWidth();

  const {
    data: observation,
    loading,
    error,
  } = useFirestoreDoc<Observation>(`${COLLECTIONS.observations}/${observationId ?? ''}`);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: rubrics } = useFirestoreCollection<Rubric>(COLLECTIONS.rubrics);

  // Finalized observations carry a rubric snapshot frozen at finalize time
  // (written server-side by finalizeObservation) so later rubric edits can't
  // silently rewrite the criteria the staff member was actually scored
  // against. Legacy finalized docs without one fall back to the live rubric.
  const rubricSnapshot =
    observation?.status === OBSERVATION_STATUS.finalized
      ? (observation.rubricSnapshot ?? null)
      : null;

  // Derive rubric for this observation: the frozen snapshot when finalized,
  // otherwise looked up live via the observed role slug → role doc →
  // rubricId.
  const rubric = useMemo<Rubric | null>(() => {
    if (rubricSnapshot) {
      const capturedAt = toJsDate(rubricSnapshot.capturedAt) ?? new Date(0);
      return {
        rubricId: rubricSnapshot.rubricId,
        displayName: rubricSnapshot.displayName,
        domains: rubricSnapshot.domains,
        createdAt: capturedAt,
        updatedAt: capturedAt,
      };
    }
    if (!observation || !roles || !rubrics) return null;
    const role = roles.find((r) => r.roleId === observation.observedRole);
    if (!role) return null;
    return rubrics.find((rb) => rb.id === role.rubricId) ?? null;
  }, [rubricSnapshot, observation, roles, rubrics]);

  const observedRoleLabel = roleDisplayName(roles, observation?.observedRole);

  // An observation created from a booked slot carries scheduling linkage and,
  // optionally, sign-up answers captured at booking. Surface that context (the
  // scheduled window + Q&A) when present; manually-created observations have
  // no slot and skip these read-only affordances entirely.
  const isBookedObservation = observation?.slotId != null || observation?.scheduledStartAt != null;

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
  // Snapshot domains are already resolved to the components in play at
  // finalize time, so the live role-year mapping must not re-filter them.
  const activeComponents: { domain: RubricDomain; component: RubricComponent }[] = useMemo(() => {
    if (!rubric) return [];
    const allow = !rubricSnapshot && mapping ? new Set(mapping.assignedComponentIds) : null;
    const out: { domain: RubricDomain; component: RubricComponent }[] = [];
    for (const d of rubric.domains) {
      for (const c of d.components) {
        if (!allow || allow.has(c.id)) {
          out.push({ domain: d, component: c });
        }
      }
    }
    return out;
  }, [rubric, mapping, rubricSnapshot]);

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
  // Number of consecutive automatic retries attempted since the last
  // successful save; reset to 0 on success. Drives the backoff schedule
  // below and caps how many times we retry unattended.
  const autoRetryCountRef = useRef(0);
  // Browser-reported connectivity — lets the save indicator distinguish
  // "we're offline, will retry automatically" from a real save error, and
  // lets us auto-flush the moment the connection comes back rather than
  // waiting on the debounce/backoff schedule. See issue #32.
  const isOnline = useOnlineStatus();
  // Mirrors savingState in a ref so the reconnect effect below can read the
  // latest value without re-running every time savingState changes (it
  // should only act on isOnline transitions).
  const savingStateRef = useRef(savingState);
  useEffect(() => {
    savingStateRef.current = savingState;
  }, [savingState]);
  const isFirstOnlineRender = useRef(true);

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [justFinalized, setJustFinalized] = useState<FinalizeResponse | null>(null);

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

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
      autoRetryCountRef.current = 0;
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

  // Automatic retry with backoff after a save failure. Re-runs whenever
  // savingState changes: entering 'error' schedules the next attempt (and
  // bumps the counter so the delay grows each time); a manual Retry click or
  // a fresh keystroke moves savingState to 'saving', which unmounts this
  // effect instance and clears the pending timer before it fires — so there
  // is never a double flush. Success resets the counter in flush() above.
  useEffect(() => {
    if (savingState !== 'error') return;
    // Don't burn a retry attempt while the browser reports no connectivity —
    // the dedicated reconnect effect below fires an immediate flush the
    // moment we're back online instead.
    if (!isOnline) return;
    if (autoRetryCountRef.current >= AUTOSAVE_MAX_AUTO_RETRIES) return;
    const attempt = autoRetryCountRef.current;
    autoRetryCountRef.current = attempt + 1;
    const delay = Math.min(AUTOSAVE_RETRY_BASE_MS * 2 ** attempt, AUTOSAVE_RETRY_MAX_MS);
    const timer = setTimeout(() => {
      void flush();
    }, delay);
    return () => clearTimeout(timer);
  }, [savingState, isOnline, flush]);

  // The moment the browser reports it's back online, flush any save that
  // was pending or failed while offline right away, rather than waiting for
  // the debounce window or the exponential backoff timer to catch up.
  useEffect(() => {
    if (isFirstOnlineRender.current) {
      // Skip the mount render — this should only react to an actual
      // offline→online transition, not the initial (assumed online) value.
      isFirstOnlineRender.current = false;
      return;
    }
    if (!isOnline) return;
    // Don't force a second concurrent write if one is still in flight — the
    // Firestore SDK retries internally and will resolve it now that we're
    // back online. Only step in for a debounced-but-unflushed edit or a
    // save that already failed.
    const hasPendingWork = flushTimer.current !== null || savingStateRef.current === 'error';
    if (!hasPendingWork) return;
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    autoRetryCountRef.current = 0;
    void flush();
  }, [isOnline, flush]);

  // Manual retry: force-flush right away, bypassing the debounce and any
  // pending backoff timer (cleared automatically by the effect above once
  // savingState flips to 'saving').
  const retrySave = useCallback(() => {
    void flush();
  }, [flush]);

  // KEEP the lowercase normalization — observerEmail is stored lowercased
  // when the observation is created, but Firebase Auth's User#email reflects
  // the case the user typed. Without this, the 233 imported observations
  // would silently flip to read-only for their original observer.
  const isReadOnly = observation?.status === OBSERVATION_STATUS.finalized;
  const isObserver = observation?.observerEmail === user?.email?.toLowerCase();
  // Admins may also edit Drafts (firestore.rules allows admin updates of any
  // field) — most importantly after reopening a finalized observation to fix
  // a mistake, when the admin isn't necessarily the original observer.
  const canEdit = !isReadOnly && (isObserver || isAdminUser);
  const showFinalize = canEdit && observation?.status === OBSERVATION_STATUS.draft;
  // Admin-only escape hatch: reopen a finalized observation for correction.
  const showReopen = isReadOnly && isAdminUser;

  // Warn before the tab/page is discarded while a save is pending or has
  // failed — a debounced-but-not-yet-flushed edit, an in-flight write, or a
  // write that errored out would otherwise be lost silently. Browsers ignore
  // custom text and show their own generic prompt, but setting returnValue
  // is what triggers that prompt at all.
  useEffect(() => {
    if (!canEdit) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      const hasUnsavedWork =
        flushTimer.current !== null || savingState === 'saving' || savingState === 'error';
      if (!hasUnsavedWork) return;
      e.preventDefault();
      // Deprecated, but legacy Chrome/Edge only show the prompt when
      // returnValue is set — preventDefault() alone is not enough there.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [canEdit, savingState]);

  // Best-effort save when the tab is backgrounded/switched away from —
  // mobile browsers in particular may discard a hidden tab outright without
  // ever firing beforeunload, so this is the more reliable place to flush a
  // pending debounce window rather than relying on the user coming back.
  useEffect(() => {
    if (!canEdit) return;
    function handleVisibilityChange() {
      if (document.visibilityState !== 'hidden') return;
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
        void flush();
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [canEdit, flush]);

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

  // Bridge from the audio popover: append a completed transcript to the
  // script doc, clearly delimited under a "Transcript — Recording N"
  // heading, so auto-tag (geminiTagScript) and the PDF can see it. Goes
  // through the same draft + autosave path as typing in the ScriptEditor —
  // the editor picks up the new content via its value-sync effect.
  const insertTranscriptIntoScript = useCallback(
    (audioFileId: string) => {
      if (!canEdit || !observation) return;
      const transcript = observation.transcripts[audioFileId];
      if (!transcript || transcript.trim().length === 0) return;
      const recordingIndex = observation.audioDriveFileIds.indexOf(audioFileId);
      const label =
        recordingIndex >= 0 ? `Transcript — Recording ${String(recordingIndex + 1)}` : 'Transcript';
      const next: EditorDraft = {
        ...draftRef.current,
        scriptDoc: appendTranscriptToScriptDoc(draftRef.current.scriptDoc, transcript, label),
      };
      draftRef.current = next;
      setDraft(next);
      scheduleSave();
    },
    [canEdit, observation, scheduleSave],
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

  async function handleReopen(reason: string) {
    if (!observation) return;
    setReopening(true);
    setReopenError(null);
    try {
      await reopenObservationFn({ observationId: observation.id, reason });
      // Clear the stale "just finalized" banner — its links still work (the
      // Drive folder/PDF survive a reopen), but the message no longer
      // reflects the observation's state.
      setJustFinalized(null);
      setReopenOpen(false);
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : 'Reopen failed');
    } finally {
      setReopening(false);
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
                {...(isBookedObservation
                  ? {
                      booking: {
                        scheduledStartAt: observation.scheduledStartAt,
                        scheduledEndAt: observation.scheduledEndAt,
                        signupDetails: observation.signupDetails,
                      },
                    }
                  : {})}
              />
              <StatusBadge status={observation.status} />
              <SaveStatusIndicator
                state={savingState}
                error={saveError}
                onRetry={retrySave}
                isOnline={isOnline}
              />
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
        onInsertTranscript={insertTranscriptIntoScript}
        showFinalize={showFinalize}
        onFinalize={() => setFinalizeOpen(true)}
        showReopen={showReopen}
        onReopen={() => setReopenOpen(true)}
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

        <ReopenDialog
          open={reopenOpen}
          onOpenChange={(open) => {
            if (!reopening) setReopenOpen(open);
          }}
          observation={observation}
          reopening={reopening}
          error={reopenError}
          onConfirm={(reason) => void handleReopen(reason)}
        />

        {!canEdit && !isReadOnly ? (
          <div className="bg-ops-blue-lighter border-l-ops-gray text-ops-gray-dark rounded-lg border-l-4 px-4 py-2.5 text-sm">
            You can view this observation but not edit it (you&apos;re not the observer).
          </div>
        ) : null}
        {isReadOnly ? (
          <div className="bg-ops-blue-lighter border-l-ops-blue text-ops-blue-dark rounded-lg border-l-4 px-4 py-2.5 text-sm">
            This observation is finalized and read-only.
            {rubricSnapshot
              ? ' Rubric criteria are shown exactly as they were when it was finalized, even if the rubric has since been edited.'
              : ''}
            {showReopen
              ? ' As an admin, you can reopen it for corrections using the Reopen button above.'
              : ''}
          </div>
        ) : null}

        {isBookedObservation ? (
          <SignupDetailsCard
            scheduledStartAt={observation.scheduledStartAt}
            scheduledEndAt={observation.scheduledEndAt}
            signupDetails={observation.signupDetails}
          />
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
          // full-width control. Hidden when rendering from a finalize-time
          // rubric snapshot — the snapshot only carries the components
          // actually in play, so there is no "full rubric" to flip to.
          actions={
            rubricSnapshot ? undefined : (
              <AssignmentToggle value={assignmentMode} onChange={setAssignmentMode} fullWidth />
            )
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
          <RubricGrid
            rubric={visibleRubric}
            mode={{
              kind: 'edit',
              entries: draft.observationData,
              notes: draft.componentNotes,
              ...(draft.scriptDoc ? { scriptDoc: draft.scriptDoc } : {}),
              evidenceLinks: observation.evidenceLinks ?? {},
              observationId: observation.id,
              readOnly: !canEdit,
              onProficiency: (componentId, proficiency) =>
                updateEntry(componentId, { proficiency }),
              onToggleLookFor: toggleLookFor,
              onNotesChange: setNotesDoc,
            }}
            storageScope={`edit-${observation.id}`}
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

interface EditorToolbarProps {
  chromeRef: React.RefObject<HTMLDivElement | null>;
  observation: Observation & { id: string };
  canEdit: boolean;
  rubric: Rubric | null;
  onInsertTranscript: (audioFileId: string) => void;
  showFinalize: boolean;
  onFinalize: () => void;
  showReopen: boolean;
  onReopen: () => void;
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
  onInsertTranscript,
  showFinalize,
  onFinalize,
  showReopen,
  onReopen,
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
              onInsertTranscript={onInsertTranscript}
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
          {showReopen ? (
            <Button
              onClick={onReopen}
              size="sm"
              variant="outline"
              className="border-ops-blue text-ops-blue hover:bg-ops-blue-lighter/40 hover:text-ops-blue-dark h-9 px-3 font-semibold"
            >
              <RotateCcw className="h-4 w-4" />
              Reopen
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
  booking,
}: {
  role: string;
  year: number | string;
  type: string;
  /** Present only when the observation was created from a booked slot. */
  booking?: {
    scheduledStartAt: unknown;
    scheduledEndAt: unknown;
    signupDetails: SignupFieldAnswer[];
  };
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
          {booking ? (
            <div className="mt-2 border-t border-gray-100 pt-2">
              <SignupDetailsDisplay
                scheduledStartAt={booking.scheduledStartAt}
                scheduledEndAt={booking.scheduledEndAt}
                signupDetails={booking.signupDetails}
              />
            </div>
          ) : null}
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

/**
 * Admin-only confirm dialog for reopening a finalized observation. Explains
 * exactly what a reopen does (and doesn't) touch, and collects an optional
 * reason that lands in the audit log.
 */
function ReopenDialog({
  open,
  onOpenChange,
  observation,
  reopening,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  observation: Observation;
  reopening: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  // Start each visit with a blank reason so a stale one from a previous
  // reopen isn't silently logged again.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen observation</DialogTitle>
          <DialogDescription>
            This unlocks the finalized observation so it can be corrected and finalized again.
            Re-finalizing regenerates the PDF (replacing the current one in Drive, so shared links
            keep working) and re-sends the finalized notification to{' '}
            <strong>{observation.observedEmail}</strong>.
          </DialogDescription>
        </DialogHeader>
        <ul className="text-muted-foreground space-y-1 px-1 py-2 text-sm">
          <li>· Observed: {observation.observedName}</li>
          <li>
            · The Drive folder stays shared — the current PDF remains visible until re-finalized.
          </li>
          <li>
            · Any acknowledgement is cleared; the staff member will need to re-acknowledge after
            re-finalization.
          </li>
          <li>· The reopen is recorded in the audit log.</li>
        </ul>
        <div className="space-y-1.5">
          <label htmlFor="reopen-reason" className="text-sm font-medium">
            Reason <span className="text-muted-foreground font-normal">(optional, logged)</span>
          </label>
          <Textarea
            id="reopen-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="e.g. Wrong observation date — needs correction"
            disabled={reopening}
          />
        </div>
        {error ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={reopening}
            type="button"
          >
            Cancel
          </Button>
          <Button onClick={() => onConfirm(reason.trim())} disabled={reopening}>
            {reopening ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Reopening…
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4" />
                Reopen
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
