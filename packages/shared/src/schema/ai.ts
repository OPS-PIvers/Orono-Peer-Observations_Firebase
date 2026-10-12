import { z } from 'zod';
import { email, isoDate } from './common.js';

/**
 * AI model registry, per-task routing and usage tracking.
 *
 * The registry lives on `/appSettings/global.aiModels`. Each AI feature
 * (`/appSettings/global.gemini.<feature>.model`) points at a registry entry
 * by its `id`. Every call the server makes is metered into
 * `/aiUsageDaily/{YYYY-MM-DD}` (running totals) and `/aiUsageEvents/{id}`
 * (one row per call), which the admin console reads live.
 *
 * Prices are stored per model so spend is computed at call time with the
 * rate the admin entered. They are estimates: the provider's invoice is the
 * source of truth.
 */

export const AI_PROVIDERS = ['gemini', 'claude'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: 'Gemini (Vertex AI)',
  claude: 'Claude (Anthropic API)',
};

/** Model id shapes each provider accepts. */
const MODEL_ID_PATTERNS: Record<AiProvider, RegExp> = {
  gemini: /^gemini-[a-z0-9.-]+$/,
  claude: /^claude-[a-z0-9.-]+$/,
};

/** Any model id the app can route to. */
export const AI_MODEL_ID_PATTERN = /^(gemini|claude)-[a-z0-9.-]+$/;

export function providerForModelId(id: string): AiProvider | null {
  for (const provider of AI_PROVIDERS) {
    if (MODEL_ID_PATTERNS[provider].test(id)) return provider;
  }
  return null;
}

export const aiModel = z
  .object({
    /** Exact id sent to the provider, e.g. `gemini-3.5-flash-lite` or `claude-haiku-5-5`. */
    id: z
      .string()
      .trim()
      .regex(AI_MODEL_ID_PATTERN, 'Model id must start with "gemini-" or "claude-"'),
    provider: z.enum(AI_PROVIDERS),
    label: z.string().trim().min(1).max(60),
    /** One line shown next to the model in pickers. */
    note: z.string().trim().max(120).default(''),
    /** USD per 1M input tokens. */
    inputUsdPerMTok: z.number().min(0).max(1000),
    /** USD per 1M output tokens (thinking tokens bill as output). */
    outputUsdPerMTok: z.number().min(0).max(1000),
    /** Accepts audio input. Only these can run audio transcription. */
    supportsAudio: z.boolean().default(false),
    /** Disabled models stay in the list (and in usage history) but can't be picked. */
    enabled: z.boolean().default(true),
  })
  .refine((m) => MODEL_ID_PATTERNS[m.provider].test(m.id), {
    message: 'Model id does not match the provider',
    path: ['id'],
  });
export type AiModel = z.infer<typeof aiModel>;

export const DEFAULT_AI_MODEL_ID = 'gemini-3.5-flash-lite';

/** The model every feature falls back to. */
export const DEFAULT_AI_MODEL: AiModel = {
  id: DEFAULT_AI_MODEL_ID,
  provider: 'gemini',
  label: 'Gemini 3.5 Flash-Lite',
  note: 'Cheapest and fastest. Handles audio.',
  inputUsdPerMTok: 0.3,
  outputUsdPerMTok: 2.5,
  supportsAudio: true,
  enabled: true,
};

/** What a tenant gets before anyone edits the registry. */
export const DEFAULT_AI_MODELS: AiModel[] = [DEFAULT_AI_MODEL];

/**
 * Models offered as one-click presets in "Add model". Not stored anywhere
 * until an admin adds one; prices are list prices at the time of writing
 * and are editable after adding.
 */
export const AI_MODEL_PRESETS: AiModel[] = [
  ...DEFAULT_AI_MODELS,
  {
    id: 'gemini-3.5-flash',
    provider: 'gemini',
    label: 'Gemini 3.5 Flash',
    note: 'Smarter than Flash-Lite, about 5x the price. Handles audio.',
    inputUsdPerMTok: 1.5,
    outputUsdPerMTok: 9,
    supportsAudio: true,
    enabled: true,
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'claude',
    label: 'Claude Haiku 5.5',
    note: 'Fast, low-cost Claude. Text only.',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    supportsAudio: false,
    enabled: true,
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'claude',
    label: 'Claude Sonnet 5.5',
    note: 'Balanced quality and cost. Text only.',
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    supportsAudio: false,
    enabled: true,
  },
  {
    id: 'claude-opus-5-5',
    provider: 'claude',
    label: 'Claude Opus 5.5',
    note: 'Most capable Opus. Text only.',
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    supportsAudio: false,
    enabled: true,
  },
];

export const AI_FEATURE_KEYS = ['audioTranscription', 'scriptAutoTag'] as const;
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];

/** What each feature needs from a model. */
export const AI_FEATURE_REQUIREMENTS: Record<AiFeatureKey, { audio: boolean }> = {
  audioTranscription: { audio: true },
  scriptAutoTag: { audio: false },
};

/** Whether `model` can run `feature` (enabled, and audio-capable where needed). */
export function modelFitsFeature(model: AiModel, feature: AiFeatureKey): boolean {
  if (!model.enabled) return false;
  return !AI_FEATURE_REQUIREMENTS[feature].audio || model.supportsAudio;
}

/**
 * The registry as stored, cleaned up: invalid entries and duplicate ids are
 * dropped, and an empty or missing list falls back to {@link DEFAULT_AI_MODELS}.
 */
export function resolveAiModels(raw: unknown): AiModel[] {
  if (!Array.isArray(raw)) return DEFAULT_AI_MODELS;
  const seen = new Set<string>();
  const out: AiModel[] = [];
  for (const entry of raw) {
    const parsed = aiModel.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push(parsed.data);
  }
  return out.length > 0 ? out : DEFAULT_AI_MODELS;
}

/**
 * The registry entry a feature should actually call. A stored model that is
 * missing from the registry, disabled, or can't do the job (a text-only
 * model on transcription) falls back to the first model that can, then to
 * the built-in default.
 */
export function resolveFeatureModel(
  models: readonly AiModel[],
  feature: AiFeatureKey,
  storedModelId: string | null | undefined,
): AiModel {
  const chosen = models.find((m) => m.id === storedModelId);
  if (chosen && modelFitsFeature(chosen, feature)) return chosen;
  return models.find((m) => modelFitsFeature(m, feature)) ?? DEFAULT_AI_MODEL;
}

/** Estimated USD for one call. */
export function estimateCostUsd(
  model: Pick<AiModel, 'inputUsdPerMTok' | 'outputUsdPerMTok'>,
  inputTokens: number,
  outputTokens: number,
): number {
  return (inputTokens * model.inputUsdPerMTok + outputTokens * model.outputUsdPerMTok) / 1_000_000;
}

// ─── Usage ──────────────────────────────────────────────────────────────────

export const aiUsageTotals = z.object({
  calls: z.number().default(0),
  errors: z.number().default(0),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  costUsd: z.number().default(0),
});
export type AiUsageTotals = z.infer<typeof aiUsageTotals>;

/**
 * /aiUsageDaily/{YYYY-MM-DD} — running totals for one district-local day,
 * incremented by the server after every AI call. Map keys are model ids and
 * feature keys.
 */
export const aiUsageDaily = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totals: aiUsageTotals.default({
    calls: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }),
  byModel: z
    .record(z.string(), aiUsageTotals.extend({ provider: z.enum(AI_PROVIDERS) }))
    .default({}),
  byFeature: z.record(z.string(), aiUsageTotals).default({}),
  updatedAt: isoDate.optional(),
});
export type AiUsageDaily = z.infer<typeof aiUsageDaily>;

/** /aiUsageEvents/{autoId} — one row per AI call, newest read first. */
export const aiUsageEvent = z.object({
  createdAt: isoDate,
  feature: z.enum(AI_FEATURE_KEYS),
  modelId: z.string(),
  provider: z.enum(AI_PROVIDERS),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  costUsd: z.number().default(0),
  ok: z.boolean().default(true),
  /** Short, staff-safe reason when `ok` is false. */
  error: z.string().nullable().default(null),
  latencyMs: z.number().nullable().default(null),
  userEmail: email.nullable().default(null),
  observationId: z.string().nullable().default(null),
});
export type AiUsageEvent = z.infer<typeof aiUsageEvent>;

/** District-local calendar date (America/Chicago) as YYYY-MM-DD. */
export function aiUsageDayKey(at: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
