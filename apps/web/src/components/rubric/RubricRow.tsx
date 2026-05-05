import { useRef, useState } from 'react';
import { Check, FileText, Lightbulb, Paperclip } from 'lucide-react';
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
import { RUBRIC_GRID_COLS, type RubricGridMode } from './RubricGrid';

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

            <div className="flex flex-wrap items-center gap-1">
              {showLookForsChip && (
                <CellChip
                  active={active === 'lookfors'}
                  onClick={() => togglePanel('lookfors')}
                  icon={<Lightbulb className="h-3 w-3" />}
                  label="Look-fors"
                  count={component.lookFors.length}
                  {...(selectedLookForCount > 0 ? { badge: selectedLookForCount } : {})}
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

      {/* Single combined drop-down panel — only one section visible at a
          time so adjacent rows stay flush when nothing is open. */}
      {active !== null ? (
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
            <TiptapEditor
              value={notesDoc}
              onChange={handleNotesChange}
              readOnly={readOnly}
              placeholder="Capture observations, evidence, and feedback for this component."
              variant="full"
              minHeight="8rem"
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
      ) : null}

      {/* Hidden file input persists across panel toggles so an in-flight
          upload survives closing the panel. */}
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
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
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
        <span
          className={cn(
            'ml-0.5 inline-flex min-w-[14px] items-center justify-center rounded-full px-1 text-[10px] font-semibold',
            active ? 'bg-ops-red text-white' : 'bg-ops-red text-white',
          )}
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
