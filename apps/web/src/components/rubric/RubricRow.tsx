import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, NotebookPen } from 'lucide-react';
import {
  PROFICIENCY_LEVELS,
  type ObservationComponentEntry,
  type ProficiencyLevel,
  type RubricComponent,
  type RubricDomain,
  type TiptapDoc,
} from '@ops/shared';
import { TiptapEditor } from '@/components/ui/tiptap-editor';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { RubricGridMode } from './RubricGrid';

const EMPTY_ENTRY: ObservationComponentEntry = {
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
 * In `view` mode the descriptor cells are read-only text; an assignment
 * chip distinguishes assigned components from full-rubric ones.
 *
 * In `edit` mode the descriptor cells are clickable. Selecting a cell
 * fires `onProficiency`; clicking the same cell again clears it. The
 * Tiptap notes editor lazy-mounts only when the strip is expanded — the
 * hidden cost otherwise compounds across ~20 rows on a typical rubric.
 */
export function RubricRow({ domain, component, mode, storageScope }: RubricRowProps) {
  const entry = mode.kind === 'edit' ? (mode.entries[component.id] ?? EMPTY_ENTRY) : EMPTY_ENTRY;
  const notesDoc = mode.kind === 'edit' ? mode.notes[component.id] : undefined;
  const readOnly = mode.kind !== 'edit' || mode.readOnly;

  const lookForsKey = `rubric-lookfors:${storageScope}:${component.id}`;
  const [lookForsExpanded, setLookForsExpanded] = useSessionStorageBoolean(lookForsKey, false);

  // Notes strip auto-expands once when the component already has content
  // (e.g. opening a finalized observation, or hydrating from Firestore on
  // a draft). After the user collapses it manually, we honor that.
  const notesHasContent = useMemo(() => hasTiptapContent(notesDoc), [notesDoc]);
  const [notesExpanded, setNotesExpanded] = useState(notesHasContent);
  const notesAutoExpandedRef = useRef(false);
  useEffect(() => {
    if (!notesAutoExpandedRef.current && notesHasContent) {
      notesAutoExpandedRef.current = true;
      setNotesExpanded(true);
    }
  }, [notesHasContent]);

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
    <div className="border-border border-b last:border-b-0">
      <div
        className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] items-stretch"
        role="row"
        data-component-row={component.id}
      >
        {/* Component title cell */}
        <div className="bg-background flex flex-col gap-1 px-3 py-3">
          <div className="flex items-center gap-2">
            {mode.kind === 'view' ? (
              <span
                aria-label={isAssigned ? 'Assigned' : 'Not assigned'}
                title={isAssigned ? 'Assigned to your role/year' : 'Not part of your assignment'}
                className={cn(
                  'inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  isAssigned
                    ? 'bg-ops-blue text-white'
                    : 'border-ops-gray-lighter text-ops-gray-light border bg-white',
                )}
              >
                {isAssigned ? '✓' : '○'}
              </span>
            ) : null}
            <span className="text-muted-foreground font-mono text-xs">{component.id}</span>
          </div>
          <p className="text-foreground text-sm leading-snug font-medium">{component.title}</p>
          <span className="text-muted-foreground text-[11px]">Domain {domain.id}</span>
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

      {/* Look-fors + notes strips */}
      <div className="bg-muted/30 border-border border-t px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          {component.lookFors.length > 0 ? (
            <button
              type="button"
              onClick={() => setLookForsExpanded((v) => !v)}
              aria-expanded={lookForsExpanded}
              aria-controls={`lookfors-${storageScope}-${component.id}`}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 transition-transform', lookForsExpanded && 'rotate-90')}
              />
              Look-fors ({component.lookFors.length})
              {mode.kind === 'edit' && entry.selectedLookForIds.length > 0 ? (
                <span className="bg-ops-blue rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white">
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
              className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs font-medium"
            >
              <NotebookPen className="h-3.5 w-3.5" />
              {notesExpanded ? 'Hide notes' : notesHasContent ? 'View notes' : 'Add notes'}
            </button>
          ) : null}

          {component.bestPractices ? <BestPracticesPopover text={component.bestPractices} /> : null}
        </div>

        {component.lookFors.length > 0 && lookForsExpanded ? (
          <ul id={`lookfors-${storageScope}-${component.id}`} className="mt-2 space-y-1 pl-5">
            {component.lookFors.map((lf) => (
              <li key={lf.id}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={mode.kind === 'edit' && entry.selectedLookForIds.includes(lf.id)}
                    disabled={readOnly}
                    onChange={() => handleToggleLookFor(lf.id)}
                    className="mt-0.5 h-4 w-4"
                    aria-label={lf.text}
                  />
                  <span className={cn(readOnly && 'text-muted-foreground')}>{lf.text}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        {mode.kind === 'edit' && notesExpanded ? (
          <div id={`notes-${storageScope}-${component.id}`} className="mt-2 space-y-1">
            <Label className="text-muted-foreground text-xs">Notes for {component.id}</Label>
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
    </div>
  );
}

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
  const baseClass = 'border-border border-l px-3 py-3 text-sm leading-snug';
  const selectedClass = 'bg-ops-blue text-white';
  const unselectedClass = 'bg-background text-foreground';
  const hoverClass = interactive
    ? 'cursor-pointer hover:bg-ops-blue-lighter hover:text-ops-blue-dark transition-colors'
    : '';
  const selectedInteractiveClass =
    interactive && selected ? 'hover:bg-ops-blue hover:text-white' : '';

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
          'text-left',
          selected ? selectedClass : unselectedClass,
          hoverClass,
          selectedInteractiveClass,
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
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
      className={cn(baseClass, selected ? selectedClass : unselectedClass)}
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
      <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        Best practices
      </summary>
      <p className="text-muted-foreground bg-background border-border mt-2 rounded-md border p-3 text-sm whitespace-pre-line">
        {text}
      </p>
    </details>
  );
}

/**
 * Returns true iff the Tiptap doc has at least one non-empty text node.
 * The default empty state `{type:'doc',content:[{type:'paragraph'}]}`
 * returns false so the notes strip doesn't auto-expand for fresh drafts.
 */
function hasTiptapContent(doc: TiptapDoc | undefined): boolean {
  if (!doc?.content) return false;
  return doc.content.some((node) => {
    if (typeof node !== 'object' || node === null) return false;
    const inner = (node as { content?: unknown }).content;
    if (!Array.isArray(inner)) return false;
    return inner.some((child) => {
      if (typeof child !== 'object' || child === null) return false;
      const c = child as { type?: unknown; text?: unknown };
      return c.type === 'text' && typeof c.text === 'string' && c.text.trim() !== '';
    });
  });
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
