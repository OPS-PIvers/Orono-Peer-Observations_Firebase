import Anthropic from '@anthropic-ai/sdk';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  aiUsageDayKey,
  estimateCostUsd,
  resolveAiModels,
  resolveFeatureModel,
  type AiFeatureKey,
  type AiModel,
} from '@ops/shared';
import { geminiHttpsError, vertexGenerateContent } from './vertexGemini.js';

/**
 * Anthropic API key for Claude models, in Secret Manager. Only functions that
 * can route to Claude declare it. Create it before deploying:
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 */
export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

export interface AiCallContext {
  feature: AiFeatureKey;
  /** For function logs. */
  logContext: string;
  userEmail?: string | null;
  observationId?: string | null;
}

export interface AiTextRequest {
  prompt: string;
  /** Audio (or other file) already uploaded to GCS. Gemini only. */
  fileData?: { fileUri: string; mimeType: string };
  /** Ask for JSON matching this schema. */
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  /** Ask for the least thinking the model allows. For work that needs no
   *  reasoning (verbatim transcription): thinking bills at the output rate
   *  and eats into the output limit. Claude already runs at low effort. */
  minimalThinking?: boolean;
}

interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The model hit its output limit, so `text` stops mid-answer. */
  truncated: boolean;
}

export interface AiTextResult {
  text: string;
  /** The model hit its output limit, so `text` stops mid-answer. */
  truncated: boolean;
}

/**
 * Read the model registry and the model a feature is routed to from
 * /appSettings/global. Raw Admin SDK reads skip Zod defaults, so both go
 * through their resolvers.
 */
export async function loadFeatureModel(db: Firestore, feature: AiFeatureKey): Promise<AiModel> {
  const snap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const data = snap.exists ? snap.data() : undefined;
  const models = resolveAiModels(data?.['aiModels']);
  const stored = (data?.['gemini'] as Record<string, { model?: unknown } | undefined> | undefined)?.[
    feature
  ]?.model;
  return resolveFeatureModel(models, feature, typeof stored === 'string' ? stored : null);
}

/**
 * Run one prompt on `model` and meter it. Every call, successful or not, is
 * recorded to /aiUsageDaily and /aiUsageEvents before this returns or throws.
 */
export async function generateText(
  model: AiModel,
  request: AiTextRequest,
  ctx: AiCallContext,
): Promise<string> {
  return (await generateTextResult(model, request, ctx)).text;
}

/** generateText, also saying whether the answer was cut off at the model's
 *  output limit. Callers whose output can run long (a class-period
 *  transcript) must check it: a cut-off answer otherwise looks complete. */
export async function generateTextResult(
  model: AiModel,
  request: AiTextRequest,
  ctx: AiCallContext,
): Promise<AiTextResult> {
  const started = Date.now();
  try {
    const result =
      model.provider === 'claude'
        ? await callClaude(model, request, ctx)
        : await callGemini(model, request, ctx);
    await recordAiUsage(model, ctx, {
      ok: true,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: Date.now() - started,
    });
    if (result.truncated) {
      logger.warn(`${ctx.logContext}: AI answer hit the output limit`, {
        model: model.id,
        outputTokens: result.outputTokens,
      });
    }
    return { text: result.text, truncated: result.truncated };
  } catch (err) {
    await recordAiUsage(model, ctx, {
      ok: false,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      error: err instanceof HttpsError ? err.message : 'The AI service returned an error.',
    });
    throw err;
  }
}

async function callGemini(
  model: AiModel,
  request: AiTextRequest,
  ctx: AiCallContext,
): Promise<CallResult> {
  const parts: Record<string, unknown>[] = [{ text: request.prompt }];
  if (request.fileData) parts.push({ fileData: request.fileData });
  const generationConfig: Record<string, unknown> = {};
  if (request.jsonSchema) generationConfig['responseMimeType'] = 'application/json';
  if (request.temperature !== undefined) generationConfig['temperature'] = request.temperature;
  const thinkingLevel = request.minimalThinking ? lowestThinkingLevel(model.id) : null;

  const send = (config: Record<string, unknown>) =>
    vertexGenerateContent(
      model.id,
      {
        contents: [{ role: 'user', parts }],
        ...(Object.keys(config).length > 0 ? { generationConfig: config } : {}),
      },
      ctx.logContext,
    );
  let data;
  if (thinkingLevel) {
    try {
      data = await send({ ...generationConfig, thinkingConfig: { thinkingLevel } });
    } catch (err) {
      // A model added to the registry may not accept this level; the
      // feature matters more than the saving, so ask again without it.
      if (!(err instanceof HttpsError && err.code === 'internal')) throw err;
      logger.warn(`${ctx.logContext}: retrying without thinkingLevel`, { model: model.id });
      data = await send(generationConfig);
    }
  } else {
    data = await send(generationConfig);
  }
  const usage = data.usageMetadata ?? {};
  const candidate = data.candidates?.[0];
  return {
    // The answer can span several parts; reading only the first dropped the rest.
    text: (candidate?.content?.parts ?? [])
      .filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join(''),
    truncated: candidate?.finishReason === 'MAX_TOKENS',
    inputTokens: usage.promptTokenCount ?? 0,
    // Thinking tokens bill at the output rate.
    outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  };
}

/**
 * The lowest `thinkingLevel` a Gemini model accepts, or null when it has no
 * thinking levels (2.x models use a token budget instead). Flash models go
 * down to `minimal`; Pro stops at `low`.
 */
export function lowestThinkingLevel(modelId: string): 'minimal' | 'low' | null {
  const major = Number(/^gemini-(\d+)/.exec(modelId)?.[1]);
  if (!(major >= 3)) return null;
  return modelId.includes('flash') ? 'minimal' : 'low';
}

let anthropic: Anthropic | null = null;

async function callClaude(
  model: AiModel,
  request: AiTextRequest,
  ctx: AiCallContext,
): Promise<CallResult> {
  if (request.fileData) {
    throw new HttpsError('failed-precondition', `${model.label} cannot read audio.`);
  }
  const apiKey = ANTHROPIC_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError(
      'failed-precondition',
      'Claude is not set up yet. Please contact your administrator.',
    );
  }
  anthropic ??= new Anthropic({ apiKey });

  try {
    const response = await anthropic.messages.create({
      model: model.id,
      max_tokens: 16000,
      messages: [{ role: 'user', content: request.prompt }],
      output_config: {
        // Short classification work: low effort keeps thinking (billed as
        // output) to a minimum.
        effort: 'low',
        ...(request.jsonSchema
          ? { format: { type: 'json_schema' as const, schema: request.jsonSchema } }
          : {}),
      },
    });
    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    return {
      text,
      truncated: response.stop_reason === 'max_tokens',
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      logger.error(`${ctx.logContext}: Anthropic request failed`, {
        status: err.status as unknown,
        model: model.id,
        message: err.message.slice(0, 500),
      });
      const status: number = typeof err.status === 'number' ? err.status : 500;
      throw geminiHttpsError(status, err.message);
    }
    throw err;
  }
}

interface UsageOutcome {
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
}

/**
 * Add one call to today's running totals and the call log. Never throws:
 * losing a usage row must not fail the feature the user is waiting on.
 */
export async function recordAiUsage(
  model: AiModel,
  ctx: AiCallContext,
  outcome: UsageOutcome,
): Promise<void> {
  const costUsd = estimateCostUsd(model, outcome.inputTokens, outcome.outputTokens);
  const now = new Date();
  const day = aiUsageDayKey(now);
  const increments = {
    calls: FieldValue.increment(1),
    errors: FieldValue.increment(outcome.ok ? 0 : 1),
    inputTokens: FieldValue.increment(outcome.inputTokens),
    outputTokens: FieldValue.increment(outcome.outputTokens),
    costUsd: FieldValue.increment(costUsd),
  };
  try {
    const db = getFirestore();
    const batch = db.batch();
    // Map keys are written as object keys (not field paths), so the dots in
    // model ids like gemini-3.5-flash-lite stay part of the key.
    batch.set(
      db.doc(`${COLLECTIONS.aiUsageDaily}/${day}`),
      {
        date: day,
        totals: increments,
        byModel: { [model.id]: { ...increments, provider: model.provider } },
        byFeature: { [ctx.feature]: increments },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(db.collection(COLLECTIONS.aiUsageEvents).doc(), {
      createdAt: FieldValue.serverTimestamp(),
      feature: ctx.feature,
      modelId: model.id,
      provider: model.provider,
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      costUsd,
      ok: outcome.ok,
      error: outcome.error ?? null,
      latencyMs: outcome.latencyMs,
      userEmail: ctx.userEmail ?? null,
      observationId: ctx.observationId ?? null,
    });
    await batch.commit();
  } catch (err) {
    logger.error('recordAiUsage: failed to write usage', {
      model: model.id,
      feature: ctx.feature,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
