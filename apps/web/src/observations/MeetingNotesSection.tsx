import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { TiptapDoc } from '@ops/shared';
import { TiptapEditor } from '@/components/ui/tiptap-editor';
import { cn } from '@/lib/utils';
import { toDateInputValue, parseDateInput } from '@/utils/dateHelpers';

export interface MeetingNotesSectionProps {
  preObsDate: Date | undefined;
  preObsNotes: TiptapDoc | undefined;
  postObsDate: Date | undefined;
  postObsNotes: TiptapDoc | undefined;
  readOnly: boolean;
  onPreObsDateChange: (date: Date | undefined) => void;
  onPreObsNotesChange: (doc: TiptapDoc) => void;
  onPostObsDateChange: (date: Date | undefined) => void;
  onPostObsNotesChange: (doc: TiptapDoc) => void;
}

interface SubSectionProps {
  label: string;
  /** Stable HTML-id slug — keep distinct per sub-section ('pre' / 'post'). */
  slug: string;
  dateValue: Date | undefined;
  notesValue: TiptapDoc | undefined;
  readOnly: boolean;
  onDateChange: (date: Date | undefined) => void;
  onNotesChange: (doc: TiptapDoc) => void;
}

function SubSection({
  label,
  slug,
  dateValue,
  notesValue,
  readOnly,
  onDateChange,
  onNotesChange,
}: SubSectionProps) {
  const [open, setOpen] = useState(false);
  const dateInputId = `meeting-date-${slug}`;

  const dateLabel = dateValue
    ? dateValue.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-ops-blue-lighter/60 flex w-full items-center justify-between px-4 py-2"
      >
        <span className="text-ops-blue-dark text-sm font-medium">
          {label}
          {dateLabel ? (
            <span className="text-muted-foreground ml-2 text-xs font-normal">{dateLabel}</span>
          ) : null}
        </span>
        {open ? (
          <ChevronDown className="text-ops-blue-dark h-4 w-4" />
        ) : (
          <ChevronRight className="text-ops-blue-dark h-4 w-4" />
        )}
      </button>

      {open ? (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex items-center gap-3">
            <label htmlFor={dateInputId} className="text-ops-gray-dark text-xs font-medium">
              Date
            </label>
            <input
              id={dateInputId}
              type="date"
              value={toDateInputValue(dateValue)}
              disabled={readOnly}
              onChange={(e) => onDateChange(parseDateInput(e.target.value))}
              className={cn(
                'border-input h-9 rounded-md border px-3 text-sm',
                readOnly && 'cursor-not-allowed opacity-70',
              )}
            />
          </div>
          <TiptapEditor
            value={notesValue}
            onChange={onNotesChange}
            readOnly={readOnly}
            variant="full"
            minHeight="5rem"
            placeholder="Add meeting notes…"
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Collapsible accordion for pre/post observation meeting notes.
 * Rendered between the observation header and GlobalToolsBar.
 */
export function MeetingNotesSection({
  preObsDate,
  preObsNotes,
  postObsDate,
  postObsNotes,
  readOnly,
  onPreObsDateChange,
  onPreObsNotesChange,
  onPostObsDateChange,
  onPostObsNotesChange,
}: MeetingNotesSectionProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="bg-ops-blue-lighter px-4 py-2.5">
        <h3 className="text-ops-blue-dark text-sm font-semibold">Meeting Notes</h3>
      </div>
      <div className="divide-y divide-gray-100">
        <SubSection
          label="Pre-Observation Meeting"
          slug="pre"
          dateValue={preObsDate}
          notesValue={preObsNotes}
          readOnly={readOnly}
          onDateChange={onPreObsDateChange}
          onNotesChange={onPreObsNotesChange}
        />
        <SubSection
          label="Post-Observation Meeting"
          slug="post"
          dateValue={postObsDate}
          notesValue={postObsNotes}
          readOnly={readOnly}
          onDateChange={onPostObsDateChange}
          onNotesChange={onPostObsNotesChange}
        />
      </div>
    </div>
  );
}
