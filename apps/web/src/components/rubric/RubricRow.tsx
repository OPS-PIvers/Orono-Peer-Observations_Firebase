import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Paperclip } from 'lucide-react';
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

/**
 * One rubric component rendered as a matrix row plus collapsible
 * look-fors and (in edit mode) notes strips below it.
 *
 * In `view` mode the descriptor cells are read-only; an assignment chip
 * distinguishes assigned components. In `edit` mode cells are clickable
 * and a notes editor lazy-mounts only when the strip is expanded.
 */
export function RubricRow({ component, mode, storageScope }: RubricRowProps) {
  const entry = mode.kind === 'edit' ? (mode.entries[component.id] ?? EMPTY_ENTRY) : EMPTY_ENTRY;
  const notesDoc = mode.kind === 'edit' ? mode.notes[component.id] : undefined;
  const readOnly = mode.kind !== 'edit' || mode.readOnly;

  const lookForsKey = `rubric-lookfors:${storageScope}:${component.id}`;
  const [lookForsExpanded, setLookForsExpanded] = useSessionStorageBoolean(lookForsKey, false);

  const notesHasContent = useMemo(() => hasTiptapContent(notesDoc), [notesDoc]);
  const [notesExpanded, setNotesExpanded] = useState(notesHasContent);
  const notesAutoExpandedRef = useRef(false);
  useEffect(() => {
    if (!notesAutoExpandedRef.current && notesHasContent) {
      notesAutoExpandedRef.current = true;
      setNotesExpanded(true);
    }
  }, [notesHasContent]);

  // Evidence strip state (edit mode only)
  const evidenceFiles: DriveFileRef[] =
    mode.kind === 'edit' ? (mode.evidenceLinks[component.id] ?? []) : [];
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || mode.kind !== 'edit') return;
    // Reset so the same file can be selected again
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
      // Firestore listener in ObservationEditorPage will update evidenceLinks automatically
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

  return (
    <div
      className={cn(
        'border-border border-b last:border-b-0',
        mode.kind === 'view' && isAssigned && 'border-l-4 border-l-green-500',
        mode.kind === 'view' && !isAssigned && 'border-l-4 border-l-transparent',
      )}
    >
      {/* Grid row */}
      <div
        className={cn('grid items-stretch', RUBRIC_GRID_COLS)}
        role="row"
        data-component-row={component.id}
      >
        {/* Component label cell */}
        <div
          role="rowheader"
          aria-label={component.title}
          className="bg-ops-blue-dark flex flex-col justify-between gap-2 px-3 py-3"
        >
          <div>
            <div className="flex items-center gap-2">
              {mode.kind === 'view' ? (
                <span
                  aria-label={isAssigned ? 'Assigned' : 'Not assigned'}
                  title={isAssigned ? 'Assigned to your role/year' : 'Not part of your assignment'}
                  className={cn(
                    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                    isAssigned
                      ? 'bg-green-400 text-white'
                      : 'border border-white/20 bg-white/10 text-white/40',
                  )}
                >
                  {isAssigned ? '✓' : '○'}
                </span>
              ) : null}
              <span className="font-mono text-[11px] font-semibold text-white/50">
                {component.id}
              </span>
            </div>
            <p className="mt-1 text-sm leading-snug font-semibold text-white">{component.title}</p>
          </div>

          {/* "Assigned" text label (view mode, assigned only) */}
          {mode.kind === 'view' && isAssigned && (
            <span className="text-[10px] font-medium text-green-400 uppercase">Assigned</span>
          )}
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

      {/* Look-fors + notes control strip */}
      <div className="border-border bg-ops-blue-dark/5 border-t px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          {component.lookFors.length > 0 ? (
            <button
              type="button"
              onClick={() => setLookForsExpanded((v) => !v)}
              aria-expanded={lookForsExpanded}
              aria-controls={`lookfors-${storageScope}-${component.id}`}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                lookForsExpanded
                  ? 'bg-ops-blue text-white'
                  : 'bg-ops-blue/10 text-ops-blue hover:bg-ops-blue/20',
              )}
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 transition-transform', lookForsExpanded && 'rotate-90')}
              />
              Look-fors ({component.lookFors.length})
              {mode.kind === 'edit' && entry.selectedLookForIds.length > 0 ? (
                <span
                  className={cn(
                    'inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold',
                    lookForsExpanded ? 'bg-white/20 text-white' : 'bg-ops-blue text-white',
                  )}
                >
                  {entry.selectedLookForIds.length}
                </span>
              ) : null}
            </button>
          ) : null}

          {mode.kind === 'edit' ? (
            <button
              type="button"
              onClick={() => setNotesExpanded((v) => !v)}
              aria-expanded={notesExpanded}
              aria-controls={`notes-${storageScope}-${component.id}`}
              className="text-ops-gray-light hover:text-ops-gray-dark ml-auto inline-flex items-center gap-1 text-xs font-medium"
            >
              {notesExpanded ? 'Hide notes' : notesHasContent ? 'View notes' : 'Add notes'}
            </button>
          ) : null}

          {component.bestPractices ? <BestPracticesPopover text={component.bestPractices} /> : null}
        </div>

        {/* Look-fors panel */}
        {component.lookFors.length > 0 && lookForsExpanded ? (
          <div
            id={`lookfors-${storageScope}-${component.id}`}
            className="bg-ops-blue-lighter/40 mt-2 grid grid-cols-1 gap-1.5 p-3 sm:grid-cols-2"
          >
            {component.lookFors.map((lf) => {
              const checked = mode.kind === 'edit' && entry.selectedLookForIds.includes(lf.id);
              return (
                <label
                  key={lf.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm transition-colors',
                    checked
                      ? 'border-ops-blue bg-ops-blue/5 text-ops-blue-dark'
                      : 'hover:border-ops-blue/40 hover:bg-ops-blue/5 border-gray-200 text-gray-700',
                    readOnly && 'cursor-default',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={readOnly}
                    onChange={() => handleToggleLookFor(lf.id)}
                    className="accent-ops-blue mt-0.5 h-4 w-4"
                    aria-label={lf.text}
                  />
                  <span className={cn(readOnly && 'text-muted-foreground')}>{lf.text}</span>
                </label>
              );
            })}
          </div>
        ) : null}

        {/* Notes panel */}
        {mode.kind === 'edit' && notesExpanded ? (
          <div
            id={`notes-${storageScope}-${component.id}`}
            className="border-l-ops-blue mt-2 border-l-4 bg-gray-50 px-4 py-3"
          >
            <TiptapEditor
              value={notesDoc}
              onChange={handleNotesChange}
              readOnly={readOnly}
              placeholder="Capture observations, evidence, and feedback for this component."
              variant="full"
              minHeight="8rem"
            />
          </div>
        ) : null}
      </div>

      {/* Evidence strip (edit mode only) */}
      {mode.kind === 'edit' ? (
        <div className="border-border border-t">
          {/* Evidence strip header */}
          <div
            className={cn(
              'flex w-full items-center gap-2 px-4 py-2 text-xs transition-colors',
              evidenceExpanded
                ? 'bg-ops-blue-lighter/40 text-ops-gray-dark'
                : 'text-ops-gray hover:bg-ops-blue-lighter/40 bg-gray-50',
            )}
          >
            <button
              type="button"
              onClick={() => setEvidenceExpanded((v) => !v)}
              aria-expanded={evidenceExpanded}
              className="flex flex-1 items-center gap-2 text-left"
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">
                Evidence{evidenceFiles.length > 0 ? ` (${String(evidenceFiles.length)})` : ''}
              </span>
            </button>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="bg-ops-blue hover:bg-ops-blue-dark ml-auto rounded px-2 py-0.5 text-white"
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : '+ Add'}
              </button>
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            className="hidden"
            onChange={(e) => void handleFileSelect(e)}
          />

          {evidenceExpanded ? (
            <div className="bg-gray-50 px-4 py-3">
              {uploadError ? <p className="text-ops-red mb-2 text-xs">{uploadError}</p> : null}
              {uploading ? (
                <div className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-500">
                  <span className="animate-pulse">Uploading…</span>
                </div>
              ) : null}
              {evidenceFiles.length === 0 && !uploading ? (
                <p className="text-xs text-gray-400 italic">No evidence attached yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {evidenceFiles.map((ref) => (
                    <EvidenceChip key={ref.driveFileId} fileRef={ref} />
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
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
            ? 'bg-ops-blue text-white shadow-inner'
            : 'hover:bg-ops-blue-lighter hover:text-ops-blue-dark bg-white text-gray-700',
        )}
      >
        {selected && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[10px] text-white">
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
        selected ? 'bg-ops-blue/10 text-ops-blue-dark font-medium' : 'bg-white text-gray-700',
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

function BestPracticesPopover({ text }: { text: string }) {
  return (
    <details className="group relative">
      <summary className="text-ops-gray-light hover:text-ops-gray-dark inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        Best practices
      </summary>
      <p className="border-border bg-background mt-2 rounded-md border p-3 text-sm whitespace-pre-line text-gray-700">
        {text}
      </p>
    </details>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasTiptapContent(doc: TiptapDoc | undefined): boolean {
  return walkForText(doc);
}

function walkForText(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (n.type === 'text' && typeof n.text === 'string' && n.text.trim() !== '') return true;
  if (Array.isArray(n.content)) return n.content.some(walkForText);
  return false;
}

function useSessionStorageBoolean(
  key: string,
  initial: boolean,
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw === null) return initial;
      return raw === '1';
    } catch {
      return initial;
    }
  });

  const update = (next: boolean | ((prev: boolean) => boolean)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try {
        window.sessionStorage.setItem(key, resolved ? '1' : '0');
      } catch {
        // sessionStorage may be unavailable (private mode); UI still works.
      }
      return resolved;
    });
  };

  return [value, update];
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
