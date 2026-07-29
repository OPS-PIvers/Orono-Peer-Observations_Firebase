import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FileText, Paperclip, Search, SquareCheck } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import {
  PROFICIENCY_LEVELS,
  type DriveFileRef,
  type ObservationComponentEntry,
  type ProficiencyLevel,
  type RubricComponent,
  type RubricDomain,
  type TiptapDoc,
} from '@ops/shared';
import { functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TiptapEditor } from '@/components/ui/tiptap-editor';
import { cn } from '@/lib/utils';
import { hasTiptapContent } from '@/utils/tiptapContent';
import {
  buildScriptNotesDoc,
  extractTaggedSpansForComponent,
} from '@/observations/extract-script-tags';
import { PROFICIENCY_LABELS, RUBRIC_GRID_COLS, type RubricGridMode } from './RubricGrid';

const uploadEvidenceFn = httpsCallable<
  {
    observationId: string;
    componentId: string;
    fileName: string;
    mimeType: string;
    base64Data: string;
  },
  { driveFileId: string; name: string }
>(functions, 'uploadEvidenceFile');

const removeEvidenceFn = httpsCallable<
  { observationId: string; componentId: string; driveFileId: string },
  { ok: true }
>(functions, 'removeEvidenceFile');

export const EMPTY_ENTRY: ObservationComponentEntry = {
  proficiency: null,
  selectedLookForIds: [],
  scratchNotes: '',
};

export interface RubricRowProps {
  domain: RubricDomain;
  component: RubricComponent;
  mode: RubricGridMode;
  storageScope: string;
}

type ActivePanel = null | 'lookfors' | 'notes' | 'evidence';

/** Mobile-only: which inner section of an expanded component is open. */
type MobileSection = 'ratings' | 'lookfors' | 'notes' | 'evidence' | null;

/**
 * One rubric component rendered as a matrix row. Look-fors, notes, and
 * evidence chips live at the bottom of the dark left cell so the grid
 * itself stays cohesive — clicking a chip drops a single combined panel
 * below the row, spanning all five columns. Only one panel can be open
 * at a time per row; clicking the active chip closes it.
 */
export function RubricRow({ component, mode, storageScope }: RubricRowProps) {
  const entry = mode.kind === 'edit' ? (mode.entries[component.id] ?? EMPTY_ENTRY) : EMPTY_ENTRY;
  const notesDoc = mode.kind === 'edit' ? mode.notes[component.id] : undefined;
  const readOnly = mode.kind !== 'edit' || mode.readOnly;
  const isEdit = mode.kind === 'edit';

  const evidenceFiles: DriveFileRef[] =
    mode.kind === 'edit' ? (mode.evidenceLinks[component.id] ?? []) : [];
  const notesHasContent = hasTiptapContent(notesDoc);
  const selectedLookForCount = mode.kind === 'edit' ? entry.selectedLookForIds.length : 0;

  const [active, setActive] = useState<ActivePanel>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removingFileId, setRemovingFileId] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<DriveFileRef | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const togglePanel = (panel: NonNullable<ActivePanel>) => {
    setActive((prev) => (prev === panel ? null : panel));
  };

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || mode.kind !== 'edit') return;
    e.target.value = '';

    if (file.size > 20 * 1024 * 1024) {
      setUploadError('File exceeds 20 MB limit');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const base64Data = await fileToBase64(file);
      await uploadEvidenceFn({
        observationId: mode.observationId,
        componentId: component.id,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  // Confirmed via RemoveEvidenceDialog (not window.confirm — destructive
  // actions use the shared Dialog pattern; see WorkProductPage et al.).
  async function handleRemoveFile(fileRef: DriveFileRef) {
    if (mode.kind !== 'edit') return;
    setConfirmingRemove(null);
    setRemovingFileId(fileRef.driveFileId);
    setUploadError(null);
    try {
      await removeEvidenceFn({
        observationId: mode.observationId,
        componentId: component.id,
        driveFileId: fileRef.driveFileId,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setRemovingFileId(null);
    }
  }

  const isAssigned = mode.kind === 'view' ? mode.assignedComponentIds.has(component.id) : true;
  // Editable only in edit mode with the write lock off — same gate as
  // handleSelectProficiency below.
  //
  // ARIA pattern: WAI-ARIA APG **Toolbar** containing a set of **toggle
  // buttons** (`aria-pressed`), NOT a radiogroup. Radio semantics forbid
  // de-selecting the checked radio, but this product deliberately keeps
  // "click the selected cell again to clear it" so an observer who
  // mis-taps during a live observation can return a component to
  // unscored. A toggle button is the ARIA control that is allowed to go
  // back to `aria-pressed="false"`, and the Toolbar pattern is the one
  // that defines the roving-tabindex + arrow-key behavior implemented
  // below. "At most one pressed at a time" is enforced by app logic
  // (`observationComponentEntry.proficiency` is one nullable enum).
  const interactive = isEdit && !mode.readOnly;
  const selectedIndex = entry.proficiency ? PROFICIENCY_LEVELS.indexOf(entry.proficiency) : -1;
  // Roving tabindex (APG Toolbar): the whole toolbar is a single Tab stop
  // — the pressed button, or the first one when nothing is pressed yet.
  // Arrow keys move this index and DOM focus without activating;
  // Enter/Space (native <button> behavior) is what actually toggles.
  const [rovingIndex, setRovingIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const toggleRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    // Only follow a real selection. When the rating is cleared
    // (selectedIndex === -1) the Tab stop stays on the button the user
    // just pressed rather than jumping back to "Developing".
    if (selectedIndex >= 0) setRovingIndex(selectedIndex);
  }, [selectedIndex]);

  function handleSelectProficiency(level: ProficiencyLevel) {
    if (mode.kind !== 'edit' || mode.readOnly) return;
    const next = entry.proficiency === level ? null : level;
    mode.onProficiency(component.id, next);
  }

  /**
   * APG Toolbar keyboard behavior for a **horizontal** toolbar: Left/Right
   * Arrow move focus between the toggle buttons (wrapping at the ends),
   * Home/End jump to the first/last. Up/Down Arrow are deliberately NOT
   * handled — APG defines those for vertical toolbars only, and swallowing
   * them here would block page scrolling while focus sits in the rubric.
   */
  function handleProficiencyToolbarKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const count = PROFICIENCY_LEVELS.length;
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = (rovingIndex + 1) % count;
        break;
      case 'ArrowLeft':
        next = (rovingIndex - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    setRovingIndex(next);
    toggleRefs.current[next]?.focus();
  }

  function handleToggleLookFor(lookForId: string) {
    if (mode.kind !== 'edit' || mode.readOnly) return;
    mode.onToggleLookFor(component.id, lookForId);
  }

  function handleNotesChange(doc: TiptapDoc) {
    if (mode.kind !== 'edit' || mode.readOnly) return;
    mode.onNotesChange(component.id, doc);
  }

  const panelId = `panel-${storageScope}-${component.id}`;
  const showLookForsChip = component.lookFors.length > 0;
  const showNotesChip = isEdit;
  const showEvidenceChip = isEdit;

  const chipStrip = (
    <div className="flex flex-nowrap items-center gap-1">
      {showLookForsChip && (
        <CellChip
          active={active === 'lookfors'}
          onClick={() => togglePanel('lookfors')}
          icon={<Search className="h-3 w-3" />}
          label="Look-fors"
          hasContent={selectedLookForCount > 0}
          ariaControls={panelId}
        />
      )}
      {showNotesChip && (
        <CellChip
          active={active === 'notes'}
          onClick={() => togglePanel('notes')}
          icon={<FileText className="h-3 w-3" />}
          label="Notes"
          hasContent={notesHasContent}
          ariaControls={panelId}
        />
      )}
      {showEvidenceChip && (
        <CellChip
          active={active === 'evidence'}
          onClick={() => togglePanel('evidence')}
          icon={<Paperclip className="h-3 w-3" />}
          label="Evidence"
          {...(evidenceFiles.length > 0 ? { count: evidenceFiles.length } : {})}
          ariaControls={panelId}
        />
      )}
    </div>
  );

  const combinedPanel =
    active !== null ? (
      <div id={panelId} className="bg-ops-blue-lighter/15 border-t border-gray-200 px-4 py-3">
        {active === 'lookfors' ? (
          <LookForsPanel
            component={component}
            selectedIds={mode.kind === 'edit' ? entry.selectedLookForIds : []}
            readOnly={readOnly}
            onToggle={handleToggleLookFor}
          />
        ) : null}

        {active === 'notes' ? (
          <NotesPanel
            componentId={component.id}
            scriptDoc={mode.kind === 'edit' ? mode.scriptDoc : undefined}
            notesDoc={notesDoc}
            onNotesChange={handleNotesChange}
            readOnly={readOnly}
          />
        ) : null}

        {active === 'evidence' && isEdit ? (
          <EvidencePanel
            files={evidenceFiles}
            uploading={uploading}
            uploadError={uploadError}
            onPickFile={() => fileInputRef.current?.click()}
            onRemoveFile={setConfirmingRemove}
            removingFileId={removingFileId}
            readOnly={readOnly}
          />
        ) : null}
      </div>
    ) : null;

  const hiddenFileInput = isEdit ? (
    <input
      ref={fileInputRef}
      type="file"
      accept="*/*"
      className="hidden"
      onChange={(e) => void handleFileSelect(e)}
    />
  ) : null;

  return (
    <div>
      {/*
        No role="row"/"rowheader"/"gridcell" here (and none in
        DomainSection): the rubric matrix is a *layout* of per-component
        controls, not a data grid — see the block comment on
        DescriptorCell. Asserting row semantics without a role="grid" /
        role="table" ancestor leaves the required context role
        unsatisfied, so we assert nothing instead of something invalid.
      */}
      <div
        className={cn(
          'grid items-stretch',
          isEdit ? 'grid-cols-[280px_minmax(0,1fr)]' : RUBRIC_GRID_COLS,
        )}
        data-component-row={component.id}
      >
        {/* Component label cell (dark) — id, title, Assigned (view), chip strip. */}
        <div className="bg-ops-blue-dark flex flex-col gap-2 px-3 py-3">
          <div>
            <span className="font-mono text-[11px] font-semibold text-white/50">
              {component.id}
            </span>
            <p className="mt-1 text-sm leading-snug font-semibold text-white">{component.title}</p>
          </div>

          {/* Pushes Assigned + chips to the bottom of the cell. */}
          <div className="mt-auto flex flex-col gap-1.5">
            {mode.kind === 'view' && isAssigned && (
              <span className="text-ops-red-light inline-flex items-center gap-1 text-[10px] font-medium uppercase">
                <Check className="h-3 w-3" aria-hidden="true" />
                Assigned
              </span>
            )}

            {chipStrip}
          </div>
        </div>

        {/* Four descriptor cells.

            Interactive edit mode → an APG *toolbar* of *toggle buttons*
            (see the block comment above `interactive`).

            Finalized / read-only edit mode → the same four cells as
            plain static content wrapped in a labelled role="group", so
            nothing advertises interactive semantics for a rating that
            cannot be changed; the saved rating is carried in the group's
            accessible name and by a per-cell visually-hidden marker.

            Pure "view" mode (rubric definition browsing) has no scored
            entry at all — four plain static cells, no wrapper. */}
        {isEdit ? (
          interactive ? (
            <div
              role="toolbar"
              aria-orientation="horizontal"
              aria-label={`${component.title} proficiency rating`}
              className="grid grid-cols-4 items-stretch"
              onKeyDown={handleProficiencyToolbarKeyDown}
            >
              {PROFICIENCY_LEVELS.map((level, index) => (
                <DescriptorCell
                  key={level}
                  level={level}
                  text={component.proficiencyLevels[level]}
                  selected={entry.proficiency === level}
                  variant="toggle"
                  tabIndex={index === rovingIndex ? 0 : -1}
                  cellRef={(el) => {
                    toggleRefs.current[index] = el;
                  }}
                  onClick={() => handleSelectProficiency(level)}
                />
              ))}
            </div>
          ) : (
            <div
              role="group"
              aria-label={`${component.title} proficiency rating: ${
                entry.proficiency ? PROFICIENCY_LABELS[entry.proficiency] : 'Not rated'
              }`}
              className="grid grid-cols-4 items-stretch"
            >
              {PROFICIENCY_LEVELS.map((level) => (
                <DescriptorCell
                  key={level}
                  level={level}
                  text={component.proficiencyLevels[level]}
                  selected={entry.proficiency === level}
                  variant="static"
                />
              ))}
            </div>
          )
        ) : (
          PROFICIENCY_LEVELS.map((level) => (
            <DescriptorCell
              key={level}
              level={level}
              text={component.proficiencyLevels[level]}
              selected={false}
              variant="static"
            />
          ))
        )}
      </div>

      {combinedPanel}
      {hiddenFileInput}
      <RemoveEvidenceDialog
        fileRef={confirmingRemove}
        onCancel={() => setConfirmingRemove(null)}
        onConfirm={(f) => void handleRemoveFile(f)}
      />
    </div>
  );
}

// ─── MobileLevelRow ───────────────────────────────────────────────────────────

/**
 * One proficiency level rendered as a collapsible row inside an
 * expanded component card. Tapping the row toggles the descriptor.
 * The selected level (edit mode) is communicated by a brand-blue
 * left-bar + tint on the whole row + a checkmark — the row IS the
 * selection indicator. The Select/Clear control lives inside the
 * expanded descriptor body, so only one is on screen at a time.
 */
function MobileLevelRow({
  level,
  text,
  expanded,
  selected,
  interactive,
  onToggleExpand,
  onSelect,
}: {
  level: ProficiencyLevel;
  text: string;
  expanded: boolean;
  selected: boolean;
  interactive: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        'border-t border-gray-200 first:border-t-0',
        // Zebra-stripe non-selected rows so the four levels read
        // clearly against each other; selection class wins below.
        'even:bg-slate-100',
        selected && 'bg-ops-blue-lighter/40 border-l-ops-blue border-l-4',
      )}
    >
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        aria-label={`${level} descriptor`}
        data-proficiency={level}
        className={cn(
          // Indent under the Ratings parent (pl-10) so the hierarchy
          // reads clearly. When selected, drop one unit of padding to
          // compensate for the 4px brand-blue left border.
          // min-h-11 = 44px: this row is a primary touch target on the
          // mobile accordion, which iPad mini (744px logical portrait
          // width, below useIsDesktop's 768px breakpoint) renders.
          'flex min-h-11 w-full items-center gap-2 py-2.5 pr-4 pl-10 text-left transition-colors',
          'focus-visible:ring-ops-blue focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          !selected && 'hover:bg-ops-blue-lighter/20',
          selected && 'pl-9',
        )}
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-400 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            'text-sm',
            selected ? 'text-ops-blue-dark font-semibold' : 'font-medium text-gray-700',
          )}
        >
          {PROFICIENCY_LABELS[level]}
        </span>
        {selected ? (
          <Check className="text-ops-blue ml-1 h-4 w-4 shrink-0" aria-label="Selected" />
        ) : null}
      </button>
      {expanded ? (
        <div className="space-y-3 bg-gray-50 py-3 pr-4 pl-14">
          <p className="text-sm leading-relaxed text-gray-700">
            {text ? (
              <span className="whitespace-pre-line">{text}</span>
            ) : (
              <em className="opacity-60">No descriptor set</em>
            )}
          </p>
          {interactive ? (
            <button
              type="button"
              onClick={onSelect}
              aria-pressed={selected}
              className={cn(
                // min-h-11/min-w-11 = 44px touch target (mobile accordion).
                'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                'focus-visible:ring-ops-blue-dark focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
                selected
                  ? 'border-ops-blue text-ops-blue-dark hover:bg-ops-blue-lighter/40 border bg-white'
                  : 'bg-ops-blue hover:bg-ops-blue-dark text-white',
              )}
            >
              {selected ? (
                <>
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear selection
                </>
              ) : (
                <>Select {PROFICIENCY_LABELS[level]}</>
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── MobileSectionRow ─────────────────────────────────────────────────────────

/**
 * Generic collapsible row used for Look-fors, Notes, and Evidence
 * inside an expanded component card. Renders a toggle header and, when
 * expanded, the supplied panel content.
 */
function MobileSectionRow({
  icon,
  label,
  count,
  badge,
  badgeText,
  hasContent,
  expanded,
  onToggle,
  bodyPadding = true,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  badge?: number;
  /** A short text badge (e.g. the saved rating like "Proficient"). */
  badgeText?: string;
  hasContent?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Pad/tint the expanded body. Set false when children manage their own layout. */
  bodyPadding?: boolean;
  children: React.ReactNode;
}) {
  // Top-level section rows (Ratings / Look-fors / Notes / Evidence)
  // intentionally don't zebra-stripe — only the deepest leaf rows
  // (the proficiency levels inside Ratings) alternate. Striping at
  // multiple nesting levels caused adjacent rows to land on the
  // same shade and read as a single block.
  return (
    <div className="border-t border-gray-200">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        // min-h-11 = 44px touch target (mobile accordion section header).
        className="hover:bg-ops-blue-lighter/20 flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left transition-colors"
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-400 transition-transform',
            expanded && 'rotate-180',
          )}
          aria-hidden="true"
        />
        <span
          className="text-ops-blue-dark inline-flex h-5 w-5 items-center justify-center"
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {count !== undefined ? <span className="text-xs text-gray-500">{count}</span> : null}
        {badgeText ? (
          <span className="bg-ops-blue ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
            {badgeText}
          </span>
        ) : null}
        {badge !== undefined ? (
          <span className="bg-ops-red ml-1 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        ) : null}
        {hasContent ? (
          <span className="bg-ops-red ml-1 h-1.5 w-1.5 rounded-full" aria-label="Has content" />
        ) : null}
      </button>
      {expanded ? (
        <div className={bodyPadding ? 'bg-gray-50 px-4 py-3' : 'bg-white'}>{children}</div>
      ) : null}
    </div>
  );
}

// ─── CellChip ─────────────────────────────────────────────────────────────────

function CellChip({
  active,
  onClick,
  icon,
  label,
  count,
  badge,
  hasContent,
  ariaControls,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  badge?: number;
  hasContent?: boolean;
  ariaControls?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-controls={ariaControls}
      aria-expanded={active}
      className={cn(
        'relative inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors',
        active
          ? 'text-ops-blue-dark bg-white shadow-sm'
          : 'bg-white/10 text-white/85 hover:bg-white/20 hover:text-white',
      )}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
      {count !== undefined ? (
        <span className={cn('text-[10px]', active ? 'text-ops-blue-dark/60' : 'opacity-70')}>
          {count}
        </span>
      ) : null}
      {badge !== undefined ? (
        // Top-right notification-style badge so the chip's intrinsic
        // width never changes when the count appears or grows.
        <span
          className="bg-ops-red ring-ops-blue-dark absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ring-2"
          aria-label={`${String(badge)} selected`}
        >
          {badge}
        </span>
      ) : null}
      {hasContent && badge === undefined ? (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-ops-red' : 'bg-ops-red-light')}
          aria-label="Has content"
        />
      ) : null}
    </button>
  );
}

// ─── NotesPanel ───────────────────────────────────────────────────────────────

/**
 * Notes panel with a Script / Manual toggle. The Script tab is read-only
 * and mirrors any spans in `scriptDoc` carrying this component's tag — it
 * updates live as the observer tags more text in the script editor. The
 * Manual tab is the existing free-form notes editor, persisted to
 * `componentNotes[componentId]`.
 */
function NotesPanel({
  componentId,
  scriptDoc,
  notesDoc,
  onNotesChange,
  readOnly,
}: {
  componentId: string;
  scriptDoc: TiptapDoc | undefined;
  notesDoc: TiptapDoc | undefined;
  onNotesChange: (doc: TiptapDoc) => void;
  readOnly: boolean;
}) {
  const taggedSpans = useMemo(
    () => extractTaggedSpansForComponent(scriptDoc, componentId),
    [scriptDoc, componentId],
  );
  const scriptNotesDoc = useMemo(
    () => buildScriptNotesDoc(taggedSpans, componentId),
    [taggedSpans, componentId],
  );
  const manualHasContent = hasTiptapContent(notesDoc);

  // Default: Manual when the user already typed something, otherwise
  // Script when there's at least one tagged span (let the evidence speak
  // first), otherwise fall back to Manual so the user has a place to type.
  const initialView: 'script' | 'manual' =
    manualHasContent || taggedSpans.length === 0 ? 'manual' : 'script';
  const [view, setView] = useState<'script' | 'manual'>(initialView);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-xs">
        <NotesTab
          active={view === 'script'}
          onClick={() => setView('script')}
          label={`Script tags${taggedSpans.length > 0 ? ` (${String(taggedSpans.length)})` : ''}`}
        />
        <NotesTab
          active={view === 'manual'}
          onClick={() => setView('manual')}
          label="Manual notes"
        />
        {view === 'script' ? (
          <span className="text-muted-foreground ml-auto text-[10px] italic">
            Mirrored from the script — read only
          </span>
        ) : null}
      </div>

      {view === 'script' ? (
        taggedSpans.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed bg-white px-3 py-3 text-xs italic">
            No script tags for this component yet. Highlight text in the script editor and pick this
            component to start mirroring evidence here.
          </p>
        ) : (
          <TiptapEditor
            value={scriptNotesDoc}
            onChange={() => undefined}
            readOnly
            variant="compact"
            minHeight="6rem"
          />
        )
      ) : (
        <TiptapEditor
          value={notesDoc}
          onChange={onNotesChange}
          readOnly={readOnly}
          placeholder="Capture observations, evidence, and feedback for this component."
          variant="full"
          minHeight="8rem"
        />
      )}
    </div>
  );
}

function NotesTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active ? 'bg-ops-blue text-white' : 'bg-ops-blue/10 text-ops-blue hover:bg-ops-blue/20',
      )}
    >
      {label}
    </button>
  );
}

// ─── LookForsPanel ────────────────────────────────────────────────────────────

function LookForsPanel({
  component,
  selectedIds,
  readOnly,
  onToggle,
}: {
  component: RubricComponent;
  selectedIds: string[];
  readOnly: boolean;
  onToggle: (lookForId: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={`Look-fors for ${component.title}`}
      className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
    >
      {component.lookFors.map((lf) => {
        const checked = selectedIds.includes(lf.id);
        return (
          <label
            key={lf.id}
            className={cn(
              // The <label> is the whole click/tap target for its nested
              // 16px checkbox, so it carries the 44px minimum.
              'flex min-h-11 items-start gap-2 rounded-md border p-2 text-sm transition-colors',
              readOnly ? 'cursor-default' : 'cursor-pointer',
              checked
                ? 'border-ops-blue bg-ops-blue/5 text-ops-blue-dark'
                : 'hover:border-ops-blue/40 hover:bg-ops-blue/5 border-gray-200 bg-white text-gray-700',
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={readOnly}
              onChange={() => onToggle(lf.id)}
              className={cn(
                'accent-ops-blue mt-0.5 h-4 w-4 rounded',
                'focus-visible:ring-ops-blue focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
              )}
              aria-label={lf.text}
            />
            <span className={cn(readOnly && 'text-muted-foreground')}>{lf.text}</span>
          </label>
        );
      })}
    </div>
  );
}

// ─── EvidencePanel ────────────────────────────────────────────────────────────

function EvidencePanel({
  files,
  uploading,
  uploadError,
  onPickFile,
  onRemoveFile,
  removingFileId,
  readOnly,
}: {
  files: DriveFileRef[];
  uploading: boolean;
  uploadError: string | null;
  onPickFile: () => void;
  onRemoveFile: (fileRef: DriveFileRef) => void;
  removingFileId: string | null;
  readOnly: boolean;
}) {
  return (
    <div>
      {uploadError ? <p className="text-ops-red mb-2 text-xs">{uploadError}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {files.map((ref) => (
          <EvidenceChip
            key={ref.driveFileId}
            fileRef={ref}
            readOnly={readOnly}
            removing={removingFileId === ref.driveFileId}
            onRemove={() => onRemoveFile(ref)}
          />
        ))}
        {!readOnly ? (
          <button
            type="button"
            onClick={onPickFile}
            disabled={uploading}
            className="bg-ops-blue hover:bg-ops-blue-dark inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            {uploading ? 'Uploading…' : '+ Add file'}
          </button>
        ) : null}
        {files.length === 0 && !uploading && readOnly ? (
          <p className="text-xs text-gray-400 italic">No evidence attached.</p>
        ) : null}
      </div>
    </div>
  );
}

// ─── EvidenceChip ─────────────────────────────────────────────────────────────

function EvidenceChip({
  fileRef,
  readOnly,
  removing,
  onRemove,
}: {
  fileRef: DriveFileRef;
  readOnly: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const truncated = fileRef.name.length > 20 ? fileRef.name.slice(0, 17) + '…' : fileRef.name;
  return (
    <div className="group hover:border-ops-blue flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs">
      <span className="text-gray-700">{truncated}</span>
      <a
        href={`https://drive.google.com/file/d/${fileRef.driveFileId}/view`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-ops-blue hover:underline"
        title={`Open ${fileRef.name} in Drive`}
      >
        View ↗
      </a>
      {!readOnly ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          className="text-ops-red hover:underline disabled:opacity-60"
          title={`Remove ${fileRef.name}`}
          aria-label={`Remove ${fileRef.name}`}
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      ) : null}
    </div>
  );
}

// ─── DescriptorCell ───────────────────────────────────────────────────────────

/**
 * One proficiency descriptor cell of the desktop matrix.
 *
 * `variant="toggle"` — a native `<button>` carrying `aria-pressed`, i.e. an
 * APG **toggle button**, and a member of the enclosing `role="toolbar"`.
 * This is deliberately *not* `role="radio"`: ARIA radios cannot be
 * un-checked by activating the checked one, but the product requires
 * exactly that (click/press the selected cell again to return the
 * component to unscored). Mutual exclusion — at most one pressed per
 * component — is enforced in `handleSelectProficiency`, since
 * `observationComponentEntry.proficiency` is a single nullable enum.
 *
 * `variant="static"` — no role, no interactive semantics at all. Used for
 * a finalized/read-only observation (a rating that cannot be changed must
 * not look actionable to assistive tech) and for pure rubric-definition
 * browsing. Because a role-less element takes no `aria-label`, the
 * proficiency level (and, when set, the fact that this is the saved
 * rating) is carried by visually-hidden text inside the cell instead.
 */
function DescriptorCell({
  level,
  text,
  selected,
  variant,
  tabIndex,
  cellRef,
  onClick,
}: {
  level: ProficiencyLevel;
  text: string;
  selected: boolean;
  variant: 'toggle' | 'static';
  tabIndex?: number;
  cellRef?: (el: HTMLButtonElement | null) => void;
  onClick?: () => void;
}) {
  // min-h-11 = 44px, the repo-wide minimum touch target (see button.tsx /
  // input.tsx). The cell normally stretches far taller than that inside the
  // matrix row; the floor matters for short/empty descriptors.
  const baseClass = 'relative min-h-11 border-l border-gray-100 px-3 py-3 text-sm leading-snug';

  if (variant === 'toggle') {
    return (
      <button
        type="button"
        ref={cellRef}
        aria-pressed={selected}
        aria-label={`${PROFICIENCY_LABELS[level]} — ${text || 'no descriptor'}`}
        tabIndex={tabIndex}
        data-proficiency={level}
        onClick={onClick}
        className={cn(
          baseClass,
          'text-left transition-colors',
          'focus-visible:ring-ops-blue focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
          selected
            ? 'bg-ops-blue-lighter text-ops-blue-dark ring-ops-blue font-medium ring-2 ring-inset'
            : 'hover:bg-ops-blue-lighter/50 hover:text-ops-blue-dark bg-white text-gray-700',
        )}
      >
        {selected && (
          <span
            className="bg-ops-blue absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white"
            aria-hidden="true"
          >
            ✓
          </span>
        )}
        <CellBody text={text} />
      </button>
    );
  }

  return (
    <div
      data-proficiency={level}
      className={cn(
        baseClass,
        selected ? 'bg-ops-blue-lighter text-ops-blue-dark font-medium' : 'bg-white text-gray-700',
      )}
    >
      <span className="sr-only">
        {PROFICIENCY_LABELS[level]}
        {selected ? ' (saved rating)' : ''}:{' '}
      </span>
      <CellBody text={text} />
    </div>
  );
}

function CellBody({ text }: { text: string }) {
  if (!text) {
    return <em className="opacity-60">No descriptor set</em>;
  }
  return <span className="whitespace-pre-line">{text}</span>;
}

// ─── MobileComponentBody ──────────────────────────────────────────────────────

/**
 * Mobile-only renderer for one component's body — the four collapsible
 * sections (Ratings, Look-fors, Notes, Evidence). Does NOT include the
 * component's title/id strip; the caller owns that, since on mobile we
 * present components as horizontal tabs and the title belongs above
 * the tabs, not above each section block.
 *
 * Self-contained: owns its own per-component UI state and Firestore-
 * adjacent handlers. Re-mount via React `key` on `component.id` to
 * reset state when the user switches tabs.
 */
export function MobileComponentBody({
  component,
  mode,
}: {
  component: RubricComponent;
  mode: RubricGridMode;
  storageScope: string;
}) {
  const entry = mode.kind === 'edit' ? (mode.entries[component.id] ?? EMPTY_ENTRY) : EMPTY_ENTRY;
  const notesDoc = mode.kind === 'edit' ? mode.notes[component.id] : undefined;
  const readOnly = mode.kind !== 'edit' || mode.readOnly;
  const isEdit = mode.kind === 'edit';
  const evidenceFiles: DriveFileRef[] =
    mode.kind === 'edit' ? (mode.evidenceLinks[component.id] ?? []) : [];
  const notesHasContent = hasTiptapContent(notesDoc);
  const selectedLookForCount = mode.kind === 'edit' ? entry.selectedLookForIds.length : 0;
  const selectedLevel = mode.kind === 'edit' ? entry.proficiency : null;
  const interactive = mode.kind === 'edit' && !mode.readOnly;
  const showLookForsRow = component.lookFors.length > 0;
  const showNotesRow = isEdit;
  const showEvidenceRow = isEdit;

  const [section, setSection] = useState<MobileSection>(null);
  const [level, setLevel] = useState<ProficiencyLevel | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removingFileId, setRemovingFileId] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<DriveFileRef | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleSection(s: NonNullable<MobileSection>) {
    setSection((prev) => (prev === s ? null : s));
  }

  function handleSelectProficiency(lvl: ProficiencyLevel) {
    if (mode.kind !== 'edit' || mode.readOnly) return;
    const next = entry.proficiency === lvl ? null : lvl;
    mode.onProficiency(component.id, next);
  }

  function handleToggleLookFor(lookForId: string) {
    if (mode.kind !== 'edit' || mode.readOnly) return;
    mode.onToggleLookFor(component.id, lookForId);
  }

  function handleNotesChange(doc: TiptapDoc) {
    if (mode.kind !== 'edit' || mode.readOnly) return;
    mode.onNotesChange(component.id, doc);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || mode.kind !== 'edit') return;
    e.target.value = '';
    if (file.size > 20 * 1024 * 1024) {
      setUploadError('File exceeds 20 MB limit');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const base64Data = await fileToBase64(file);
      await uploadEvidenceFn({
        observationId: mode.observationId,
        componentId: component.id,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  // Confirmed via RemoveEvidenceDialog (not window.confirm — destructive
  // actions use the shared Dialog pattern; see WorkProductPage et al.).
  async function handleRemoveFile(fileRef: DriveFileRef) {
    if (mode.kind !== 'edit') return;
    setConfirmingRemove(null);
    setRemovingFileId(fileRef.driveFileId);
    setUploadError(null);
    try {
      await removeEvidenceFn({
        observationId: mode.observationId,
        componentId: component.id,
        driveFileId: fileRef.driveFileId,
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setRemovingFileId(null);
    }
  }

  return (
    <div data-component-row={component.id}>
      <MobileSectionRow
        icon={<SquareCheck className="h-4 w-4" />}
        label="Ratings"
        {...(selectedLevel ? { badgeText: PROFICIENCY_LABELS[selectedLevel] } : {})}
        expanded={section === 'ratings'}
        onToggle={() => toggleSection('ratings')}
        bodyPadding={false}
      >
        <div className="divide-y divide-gray-200 border-y border-gray-200">
          {PROFICIENCY_LEVELS.map((lvl) => (
            <MobileLevelRow
              key={lvl}
              level={lvl}
              text={component.proficiencyLevels[lvl]}
              expanded={level === lvl}
              selected={selectedLevel === lvl}
              interactive={interactive}
              onToggleExpand={() => setLevel((p) => (p === lvl ? null : lvl))}
              onSelect={() => handleSelectProficiency(lvl)}
            />
          ))}
        </div>
      </MobileSectionRow>

      {showLookForsRow ? (
        <MobileSectionRow
          icon={<Search className="h-4 w-4" />}
          label="Look-fors"
          {...(selectedLookForCount > 0 ? { badge: selectedLookForCount } : {})}
          expanded={section === 'lookfors'}
          onToggle={() => toggleSection('lookfors')}
        >
          <LookForsPanel
            component={component}
            selectedIds={mode.kind === 'edit' ? entry.selectedLookForIds : []}
            readOnly={readOnly}
            onToggle={handleToggleLookFor}
          />
        </MobileSectionRow>
      ) : null}

      {showNotesRow ? (
        <MobileSectionRow
          icon={<FileText className="h-4 w-4" />}
          label="Notes"
          hasContent={notesHasContent}
          expanded={section === 'notes'}
          onToggle={() => toggleSection('notes')}
        >
          <NotesPanel
            componentId={component.id}
            scriptDoc={mode.scriptDoc}
            notesDoc={notesDoc}
            onNotesChange={handleNotesChange}
            readOnly={readOnly}
          />
        </MobileSectionRow>
      ) : null}

      {showEvidenceRow ? (
        <MobileSectionRow
          icon={<Paperclip className="h-4 w-4" />}
          label="Evidence"
          {...(evidenceFiles.length > 0 ? { count: evidenceFiles.length } : {})}
          expanded={section === 'evidence'}
          onToggle={() => toggleSection('evidence')}
        >
          <EvidencePanel
            files={evidenceFiles}
            uploading={uploading}
            uploadError={uploadError}
            onPickFile={() => fileInputRef.current?.click()}
            onRemoveFile={setConfirmingRemove}
            removingFileId={removingFileId}
            readOnly={readOnly}
          />
        </MobileSectionRow>
      ) : null}

      {isEdit ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="*/*"
          className="hidden"
          onChange={(e) => void handleFileSelect(e)}
        />
      ) : null}

      <RemoveEvidenceDialog
        fileRef={confirmingRemove}
        onCancel={() => setConfirmingRemove(null)}
        onConfirm={(f) => void handleRemoveFile(f)}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Destructive-confirm dialog for removing an evidence file. Uses the shared
 * Dialog confirmation pattern (like WorkProductPage / SignupFieldsPage /
 * RoleYearMappingsPage delete flows) rather than window.confirm, and spells
 * out the consequence: the uploaded file is trashed in Google Drive.
 */
function RemoveEvidenceDialog({
  fileRef,
  onCancel,
  onConfirm,
}: {
  fileRef: DriveFileRef | null;
  onCancel: () => void;
  onConfirm: (fileRef: DriveFileRef) => void;
}) {
  return (
    <Dialog
      open={fileRef !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove evidence file</DialogTitle>
          <DialogDescription>
            Remove &ldquo;{fileRef?.name}&rdquo; from this component&apos;s evidence? The uploaded
            file will also be moved to the trash in Google Drive.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            type="button"
            onClick={() => {
              if (fileRef) onConfirm(fileRef);
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix ("data:...;base64,")
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
