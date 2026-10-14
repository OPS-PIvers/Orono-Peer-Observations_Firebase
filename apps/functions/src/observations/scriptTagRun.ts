import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SUBCOLLECTIONS,
  type AutoTagConfidence,
  type ScriptAutoTagOptions,
} from '@ops/shared';
import {
  filterVerbatimSuggestions,
  type ScriptTagSuggestion,
  type TagScope,
} from './scriptTagging.js';

/**
 * The saved result of the last auto-tag run on an observation, so a second
 * click on Auto-tag reopens it instead of paying for another AI call.
 *
 * Lives at `observations/{id}/scriptAutoTagRuns/latest`. Server-only: the
 * default-deny rule covers it and every read goes through `suggestScriptTags`,
 * which re-checks the caller's access first. Kept off the observation doc so
 * the observed teacher never reads the AI's proposals and the Sheets sync
 * trigger doesn't fire for it.
 */
export const LATEST_RUN_DOC_ID = 'latest';

/**
 * A re-run must say what changed. Short enough not to be a chore, long enough
 * that "x" or "again" doesn't pass.
 */
export const RERUN_REASON_MIN_LENGTH = 10;
export const RERUN_REASON_MAX_LENGTH = 1000;

/**
 * How long an in-flight claim blocks another run. Longer than the callable's
 * 120s timeout, so a claim left behind by a crashed call expires on its own.
 */
export const RUN_CLAIM_TTL_MS = 150_000;

/**
 * Where each suggestion stands after the observer's last Apply:
 * - `pending`   never decided (the run was reviewed and cancelled, or not yet reviewed)
 * - `applied`   written to the script
 * - `dismissed` the observer unchecked it and applied the rest
 * - `stale`     approved, but the script had changed so it no longer matched
 */
export type SuggestionStatus = 'pending' | 'applied' | 'dismissed' | 'stale';

/** What the model returns for one tag, before the verbatim check. */
export interface ModelScriptTagSuggestion extends ScriptTagSuggestion {
  /** Null when the admin turned confidence off. */
  confidence: AutoTagConfidence | null;
  /** One line on what the model saw; empty when the observer turned reasons off. */
  rationale: string;
}

export interface StoredScriptTagSuggestion extends ModelScriptTagSuggestion {
  componentTitle: string;
  paragraphText: string;
  status: SuggestionStatus;
}

export interface StoredScriptTagRun {
  scope: TagScope;
  options: ScriptAutoTagOptions;
  suggestions: StoredScriptTagSuggestion[];
  componentColors: { componentId: string; bg: string; fg: string }[];
  skippedCount: number;
  createdAt: Date;
  createdBy: string;
  modelId: string;
  /** How many AI runs this observation has had. */
  runCount: number;
  /** Why the observer asked for this run; null on the first run. */
  reason: string | null;
  /** Set while a run is in flight, cleared when it finishes or fails. */
  inFlight?: { by: string; startedAtMs: number } | null;
}

export function latestRunRef(db: Firestore, observationId: string): DocumentReference {
  return db.doc(
    `${COLLECTIONS.observations}/${observationId}/${OBSERVATION_SUBCOLLECTIONS.scriptAutoTagRuns}/${LATEST_RUN_DOC_ID}`,
  );
}

/** True when the doc holds a finished run, not just an in-flight claim. */
export function hasCompletedRun(data: Partial<StoredScriptTagRun> | undefined): boolean {
  return Array.isArray(data?.suggestions);
}

/** Whether another call's in-flight claim still blocks a new run. */
export function isClaimActive(
  data: Partial<StoredScriptTagRun> | undefined,
  nowMs: number,
): boolean {
  const startedAtMs = data?.inFlight?.startedAtMs;
  return typeof startedAtMs === 'number' && nowMs - startedAtMs < RUN_CLAIM_TTL_MS;
}

/**
 * Validate the `reason` a re-run carries. Returns the trimmed reason, or null
 * when none was sent (a first run, or a request to reopen the last result).
 */
export function parseRerunReason(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new HttpsError('invalid-argument', 'reason must be a string');
  }
  const reason = raw.trim();
  if (reason.length < RERUN_REASON_MIN_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `Say what changed or what the AI should know this time (at least ${String(RERUN_REASON_MIN_LENGTH)} characters).`,
    );
  }
  if (reason.length > RERUN_REASON_MAX_LENGTH) {
    throw new HttpsError(
      'invalid-argument',
      `Keep the reason under ${String(RERUN_REASON_MAX_LENGTH)} characters.`,
    );
  }
  return reason;
}

function suggestionKey(s: ScriptTagSuggestion): string {
  return `${String(s.paragraphIndex)}\u0000${s.componentId}\u0000${s.text}`;
}

/**
 * Record the observer's decisions from one Apply against the stored run.
 * Submitted and written → `applied`; submitted but no longer matching →
 * `stale`; still-pending ones they left unchecked → `dismissed`. Anything
 * decided on an earlier Apply keeps its status unless it was resubmitted.
 */
export function recordDecisions(
  stored: readonly StoredScriptTagSuggestion[],
  accepted: readonly ScriptTagSuggestion[],
  rejected: readonly ScriptTagSuggestion[],
): StoredScriptTagSuggestion[] {
  const acceptedKeys = new Set(accepted.map(suggestionKey));
  const rejectedKeys = new Set(rejected.map(suggestionKey));
  return stored.map((s) => {
    const key = suggestionKey(s);
    if (acceptedKeys.has(key)) return { ...s, status: 'applied' };
    if (rejectedKeys.has(key)) return { ...s, status: 'stale' };
    if (s.status === 'pending') return { ...s, status: 'dismissed' };
    return s;
  });
}

/**
 * Mark stored suggestions that no longer match the current script as `stale`
 * before they are shown again, so the review dialog doesn't offer spans the
 * observer has since edited away. Applied ones keep their status.
 */
export function markStaleSuggestions(
  stored: readonly StoredScriptTagSuggestion[],
  paragraphs: readonly string[],
  validComponentIds: ReadonlySet<string>,
): StoredScriptTagSuggestion[] {
  const { rejected } = filterVerbatimSuggestions(stored, paragraphs, validComponentIds);
  const rejectedKeys = new Set(rejected.map(suggestionKey));
  return stored.map((s) =>
    s.status !== 'applied' && rejectedKeys.has(suggestionKey(s)) ? { ...s, status: 'stale' } : s,
  );
}

/**
 * Prompt addendum for a re-run: the observer's reason, plus what they did
 * with the last batch, so the model can build on it instead of repeating it.
 */
export function rerunPromptContext(
  reason: string,
  previous: readonly StoredScriptTagSuggestion[],
): string {
  const describe = (s: StoredScriptTagSuggestion) => ({
    paragraphIndex: s.paragraphIndex,
    text: s.text,
    componentId: s.componentId,
  });
  const applied = previous.filter((s) => s.status === 'applied').map(describe);
  const dismissed = previous.filter((s) => s.status === 'dismissed').map(describe);
  let out = `\n\nRE-RUN CONTEXT:
This script was auto-tagged before. The observer asked for another pass and said:
${JSON.stringify(reason)}
Take that into account.`;
  if (applied.length > 0) {
    out += `\n\nAlready applied by the observer (do not suggest these again):\n${JSON.stringify(applied, null, 2)}`;
  }
  if (dismissed.length > 0) {
    out += `\n\nRejected by the observer last time (do not suggest these again unless the observer's note asks for it):\n${JSON.stringify(dismissed, null, 2)}`;
  }
  return out;
}
