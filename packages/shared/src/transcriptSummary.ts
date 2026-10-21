/**
 * "Send to script" options for an audio transcript. Besides the full
 * transcript, an observer can send a condensed version built from it:
 *
 *   - 'domains' — a short lesson summary, then timestamped evidence for each
 *     of the observation's assigned rubric components.
 *   - 'custom'  — the same shape, but organized around a focus the observer
 *     types ("How does the teacher respond to student answers?").
 *
 * The `summarizeTranscript` callable produces a {@link TranscriptSummary};
 * the editor turns it into script content, tagging each evidence line with
 * its component so it lands on the rubric.
 */

export const TRANSCRIPT_SUMMARY_MODES = ['domains', 'custom'] as const;
export type TranscriptSummaryMode = (typeof TRANSCRIPT_SUMMARY_MODES)[number];

/** Longest custom focus the observer may type. */
export const TRANSCRIPT_FOCUS_MAX = 500;

export interface SummarizeTranscriptRequest {
  observationId: string;
  audioFileId: string;
  mode: TranscriptSummaryMode;
  /** Required for 'custom', ignored otherwise. */
  focus?: string;
}

export interface TranscriptEvidence {
  /** "MM:SS" or "H:MM:SS" from the transcript, or null when it had none. */
  time: string | null;
  text: string;
}

export interface TranscriptSummarySection {
  /** Rubric component the evidence shows, or null for an untagged section. */
  componentId: string | null;
  /** Section title. For a component section, the component's own title. */
  heading: string;
  /** One or two sentences on what the observer would notice. */
  noticed: string;
  evidence: TranscriptEvidence[];
}

export interface TranscriptSummaryComponent {
  componentId: string;
  title: string;
  bg: string;
  fg: string;
}

export interface TranscriptSummary {
  mode: TranscriptSummaryMode;
  /** The observer's focus for 'custom', else null. */
  focus: string | null;
  summary: string;
  sections: TranscriptSummarySection[];
  reflectionQuestions: string[];
  /** Title and colors of every component a section points at. */
  components: TranscriptSummaryComponent[];
}

/** Read a callable's `mode` field. */
export function parseTranscriptSummaryMode(raw: unknown): TranscriptSummaryMode | null {
  return TRANSCRIPT_SUMMARY_MODES.includes(raw as TranscriptSummaryMode)
    ? (raw as TranscriptSummaryMode)
    : null;
}

/** Trim and bound a typed focus; null when there is nothing left. */
export function normalizeTranscriptFocus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const focus = raw.replace(/\s+/g, ' ').trim();
  return focus ? focus.slice(0, TRANSCRIPT_FOCUS_MAX) : null;
}

/** Short label for what was sent, e.g. "Assigned-domain evidence (2b, 2c)". */
export function transcriptSummaryLabel(
  summary: Pick<TranscriptSummary, 'mode' | 'sections'>,
): string {
  if (summary.mode === 'custom') return 'Custom focus';
  const ids = summary.sections.flatMap((s) => (s.componentId ? [s.componentId] : []));
  return ids.length > 0
    ? `Assigned-domain evidence (${ids.join(', ')})`
    : 'Assigned-domain evidence';
}
