import { useMemo, useRef, useState } from 'react';
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

  const isAssigned = mode.kind === 'view' ? mode.assignedComponentIds.has(component.id) : true;

  function handleSelectProficiency(level: ProficiencyLevel) {
    if (mode.kind !== 'edit' || mode.readOnly) return;
    const next = entry.proficiency === level ? null : level;
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
      <div
        className={cn('grid items-stretch', RUBRIC_GRID_COLS)}
        role="row"
        data-component-row={component.id}
      >
        {/* Component label cell (dark) — id, title, Assigned (view), chip strip. */}
        <div
          role="rowheader"
          aria-label={component.title}
          className="bg-ops-blue-dark flex flex-col gap-2 px-3 py-3"
        >
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

        {/* Four descriptor cells */}
        {PROFICIENCY_LEVELS.map((level) => {
          const text = component.proficiencyLevels[level];
          const selected = entry.proficiency === level;
          const interactive = mode.kind === 'edit' && !mode.readOnly;
          return (
            <DescriptorCell
              key={level}
              level={level}
              text={text}
              selected={selected}
              interactive={interactive}
              onClick={() => handleSelectProficiency(level)}
            />
          );
        })}
      </div>

      {combinedPanel}
      {hiddenFileInput}
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
          'flex w-full items-center gap-2 py-2.5 pr-4 pl-10 text-left transition-colors',
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
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
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
        className="hover:bg-ops-blue-lighter/20 flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors"
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
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {component.lookFors.map((lf) => {
        const checked = selectedIds.includes(lf.id);
        return (
          <label
            key={lf.id}
            className={cn(
              'flex items-start gap-2 rounded-md border p-2 text-sm transition-colors',
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
              className="accent-ops-blue mt-0.5 h-4 w-4"
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
  readOnly,
}: {
  files: DriveFileRef[];
  uploading: boolean;
  uploadError: string | null;
  onPickFile: () => void;
  readOnly: boolean;
}) {
  return (
    <div>
      {uploadError ? <p className="text-ops-red mb-2 text-xs">{uploadError}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {files.map((ref) => (
          <EvidenceChip key={ref.driveFileId} fileRef={ref} />
        ))}
        {!readOnly ? (
          <button
            type="button"
            onClick={onPickFile}
            disabled={uploading}
            className="bg-ops-blue hover:bg-ops-blue-dark inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
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

function EvidenceChip({ fileRef }: { fileRef: DriveFileRef }) {
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
    </div>
  );
}

// ─── DescriptorCell ───────────────────────────────────────────────────────────

function DescriptorCell({
  level,
  text,
  selected,
  interactive,
  onClick,
}: {
  level: ProficiencyLevel;
  text: string;
  selected: boolean;
  interactive: boolean;
  onClick: () => void;
}) {
  const baseClass = 'relative border-l border-gray-100 px-3 py-3 text-sm leading-snug';

  if (interactive) {
    return (
      <button
        type="button"
        role="gridcell"
        aria-selected={selected}
        aria-label={`${level} — ${text || 'no descriptor'}`}
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
          <span className="bg-ops-blue absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white">
            ✓
          </span>
        )}
        <CellBody text={text} />
      </button>
    );
  }

  return (
    <div
      role="gridcell"
      data-proficiency={level}
      aria-selected={selected}
      aria-label={`${level} — ${text || 'no descriptor'}`}
      className={cn(
        baseClass,
        selected ? 'bg-ops-blue-lighter text-ops-blue-dark font-medium' : 'bg-white text-gray-700',
      )}
    >
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
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
