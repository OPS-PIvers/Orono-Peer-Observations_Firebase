import type { ReactNode } from 'react';
import { useState } from 'react';
import { CalendarClock, ChevronDown } from 'lucide-react';
import type { TiptapDoc } from '@ops/shared';
import { TiptapEditor } from '@/components/ui/tiptap-editor';
import { cn } from '@/lib/utils';
import { toDateInputValue, parseDateInput } from '@/utils/dateHelpers';
import { hasTiptapContent } from '@/utils/tiptapContent';

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
  /**
   * Optional slot rendered to the far right of the toggle row at md+
   * widths, dropped below the row at narrow widths. Used by the
   * observation editor to host the Assigned/Full Rubric toggle inline
   * with Planning/Reflection on desktop.
   */
  actions?: ReactNode;
}

type ActiveTab = null | 'pre' | 'post';

interface PanelProps {
  /** Stable HTML-id slug — keep distinct per sub-section ('pre' / 'post'). */
  slug: 'pre' | 'post';
  dateValue: Date | undefined;
  notesValue: TiptapDoc | undefined;
  readOnly: boolean;
  onDateChange: (date: Date | undefined) => void;
  onNotesChange: (doc: TiptapDoc) => void;
}

function Panel({ slug, dateValue, notesValue, readOnly, onDateChange, onNotesChange }: PanelProps) {
  const dateInputId = `meeting-date-${slug}`;
  return (
    <div className="border-ops-blue-lighter mt-2 space-y-3 rounded-md border bg-white p-3">
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
  );
}

function dateLabel(d: Date | undefined): string | null {
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
}

function TabButton({
  active,
  hasContent,
  onClick,
  label,
  date,
}: {
  active: boolean;
  hasContent: boolean;
  onClick: () => void;
  label: string;
  date: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={cn(
        'flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
        'md:inline-flex md:w-auto md:shrink-0 md:justify-start',
        active
          ? 'border-ops-blue bg-ops-blue/10 text-ops-blue-dark'
          : hasContent
            ? 'border-ops-blue-lighter text-ops-blue-dark hover:bg-ops-blue-lighter/60 bg-white'
            : 'border-input text-ops-gray-dark hover:bg-ops-blue-lighter/50 bg-white',
      )}
    >
      <CalendarClock className="h-3.5 w-3.5" />
      {label}
      {date ? <span className="text-muted-foreground font-normal">· {date}</span> : null}
      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', active && 'rotate-180')} />
    </button>
  );
}

/**
 * Compact pre/post-observation notes control. Renders as a slim "Meeting
 * Notes:" label + two pill-style toggles inline with the page flow; the
 * notes editor expands beneath only when its tab is active. Replaces the
 * earlier full-width white card so the section stops dominating the page.
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
  actions,
}: MeetingNotesSectionProps) {
  const [active, setActive] = useState<ActiveTab>(null);

  return (
    <div className="space-y-2 md:space-y-0">
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-nowrap md:items-center md:overflow-x-auto">
        <span className="text-ops-gray-dark hidden shrink-0 text-xs font-semibold tracking-wide uppercase sm:inline">
          Meeting Notes
        </span>
        <TabButton
          active={active === 'pre'}
          hasContent={preObsDate !== undefined || hasTiptapContent(preObsNotes)}
          onClick={() => setActive((v) => (v === 'pre' ? null : 'pre'))}
          label="Planning"
          date={dateLabel(preObsDate)}
        />
        <TabButton
          active={active === 'post'}
          hasContent={postObsDate !== undefined || hasTiptapContent(postObsNotes)}
          onClick={() => setActive((v) => (v === 'post' ? null : 'post'))}
          label="Reflection"
          date={dateLabel(postObsDate)}
        />
        {actions ? <div className="hidden md:ml-auto md:block">{actions}</div> : null}
      </div>
      {actions ? <div className="md:hidden">{actions}</div> : null}
      {active === 'pre' ? (
        <Panel
          slug="pre"
          dateValue={preObsDate}
          notesValue={preObsNotes}
          readOnly={readOnly}
          onDateChange={onPreObsDateChange}
          onNotesChange={onPreObsNotesChange}
        />
      ) : null}
      {active === 'post' ? (
        <Panel
          slug="post"
          dateValue={postObsDate}
          notesValue={postObsNotes}
          readOnly={readOnly}
          onDateChange={onPostObsDateChange}
          onNotesChange={onPostObsNotesChange}
        />
      ) : null}
    </div>
  );
}
