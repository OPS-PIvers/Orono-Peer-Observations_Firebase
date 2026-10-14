/**
 * Options the observer picks for a script auto-tag run. The web app sends
 * them with `suggestScriptTags`; the function turns them into prompt
 * instructions and saves them with the run.
 */

/**
 * Which rubric components the AI may tag:
 * - `assigned`        only the role/year's assigned components
 * - `preferAssigned`  the whole rubric, but evidence that fits an assigned
 *                     component and another one goes to the assigned one
 * - `full`            the whole rubric, all components weighed equally
 */
export type AutoTagComponentFocus = 'assigned' | 'preferAssigned' | 'full';

/** How many tags to aim for. */
export type AutoTagDetail = 'key' | 'balanced' | 'thorough';

export interface ScriptAutoTagOptions {
  components: AutoTagComponentFocus;
  detail: AutoTagDetail;
  /** Ask for a one-line reason with each suggestion. */
  rationale: boolean;
}

/** How sure the model says it is about one suggestion. Always requested. */
export type AutoTagConfidence = 'high' | 'medium' | 'low';

export const AUTO_TAG_COMPONENT_FOCUSES: readonly AutoTagComponentFocus[] = [
  'assigned',
  'preferAssigned',
  'full',
];
export const AUTO_TAG_DETAILS: readonly AutoTagDetail[] = ['key', 'balanced', 'thorough'];
export const AUTO_TAG_CONFIDENCES: readonly AutoTagConfidence[] = ['high', 'medium', 'low'];

export const DEFAULT_SCRIPT_AUTO_TAG_OPTIONS: ScriptAutoTagOptions = {
  components: 'assigned',
  detail: 'balanced',
  rationale: true,
};

/** Whether the run reads the whole rubric (both full-rubric focuses do). */
export function autoTagUsesFullRubric(components: AutoTagComponentFocus): boolean {
  return components !== 'assigned';
}

/**
 * Read options from untrusted input, falling back field by field to the
 * defaults. `fallbackComponents` covers callers that still send only the
 * older `scope` field.
 */
export function parseScriptAutoTagOptions(
  raw: unknown,
  fallbackComponents: AutoTagComponentFocus = DEFAULT_SCRIPT_AUTO_TAG_OPTIONS.components,
): ScriptAutoTagOptions {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const components = AUTO_TAG_COMPONENT_FOCUSES.find((c) => c === r['components']);
  const detail = AUTO_TAG_DETAILS.find((d) => d === r['detail']);
  return {
    components: components ?? fallbackComponents,
    detail: detail ?? DEFAULT_SCRIPT_AUTO_TAG_OPTIONS.detail,
    rationale:
      typeof r['rationale'] === 'boolean'
        ? r['rationale']
        : DEFAULT_SCRIPT_AUTO_TAG_OPTIONS.rationale,
  };
}

/** Read a model's confidence value; anything unrecognised counts as `medium`. */
export function parseAutoTagConfidence(raw: unknown): AutoTagConfidence {
  return AUTO_TAG_CONFIDENCES.find((c) => c === raw) ?? 'medium';
}

// ─── Admin controls ──────────────────────────────────────────────────────────

/**
 * What an admin allows observers to choose, set in Admin → AI Models →
 * Features and stored at `appSettings/global.scriptAutoTagControls`. Every
 * piece defaults to on. The server clamps each request to these, so turning
 * something off takes effect even for a page that was already open.
 */
export interface ScriptAutoTagControls {
  components: Record<AutoTagComponentFocus, boolean>;
  detail: Record<AutoTagDetail, boolean>;
  /** Observers may ask for a one-line reason with each suggestion. */
  rationale: boolean;
  /** Ask the model for a confidence level and show it. */
  confidence: boolean;
  /** Observers may run auto-tag again (with a reason) after the first run. */
  rerun: boolean;
}

export const DEFAULT_SCRIPT_AUTO_TAG_CONTROLS: ScriptAutoTagControls = {
  components: { assigned: true, preferAssigned: true, full: true },
  detail: { key: true, balanced: true, thorough: true },
  rationale: true,
  confidence: true,
  rerun: true,
};

function readFlag(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/**
 * Settle whatever is stored into complete controls, field by field. At least
 * one focus and one detail level always stays on (assigned only and
 * balanced), so auto-tag can't be configured into a state with no choice.
 */
export function resolveScriptAutoTagControls(raw: unknown): ScriptAutoTagControls {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rc =
    r['components'] && typeof r['components'] === 'object'
      ? (r['components'] as Record<string, unknown>)
      : {};
  const rd =
    r['detail'] && typeof r['detail'] === 'object' ? (r['detail'] as Record<string, unknown>) : {};
  const components = Object.fromEntries(
    AUTO_TAG_COMPONENT_FOCUSES.map((c) => [c, readFlag(rc[c], true)]),
  ) as Record<AutoTagComponentFocus, boolean>;
  const detail = Object.fromEntries(
    AUTO_TAG_DETAILS.map((d) => [d, readFlag(rd[d], true)]),
  ) as Record<AutoTagDetail, boolean>;
  if (!AUTO_TAG_COMPONENT_FOCUSES.some((c) => components[c])) components.assigned = true;
  if (!AUTO_TAG_DETAILS.some((d) => detail[d])) detail.balanced = true;
  return {
    components,
    detail,
    rationale: readFlag(r['rationale'], true),
    confidence: readFlag(r['confidence'], true),
    rerun: readFlag(r['rerun'], true),
  };
}

/** Nearest allowed focus to the one asked for, closest match first. */
const FOCUS_FALLBACKS: Record<AutoTagComponentFocus, readonly AutoTagComponentFocus[]> = {
  assigned: ['assigned', 'preferAssigned', 'full'],
  preferAssigned: ['preferAssigned', 'full', 'assigned'],
  full: ['full', 'preferAssigned', 'assigned'],
};

const DETAIL_FALLBACKS: Record<AutoTagDetail, readonly AutoTagDetail[]> = {
  key: ['key', 'balanced', 'thorough'],
  balanced: ['balanced', 'key', 'thorough'],
  thorough: ['thorough', 'balanced', 'key'],
};

/** Replace anything the admin has turned off with the nearest allowed choice. */
export function clampScriptAutoTagOptions(
  options: ScriptAutoTagOptions,
  controls: ScriptAutoTagControls,
): ScriptAutoTagOptions {
  return {
    components:
      FOCUS_FALLBACKS[options.components].find((c) => controls.components[c]) ?? 'assigned',
    detail: DETAIL_FALLBACKS[options.detail].find((d) => controls.detail[d]) ?? 'balanced',
    rationale: options.rationale && controls.rationale,
  };
}
