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
}

interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
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
    return result.text;
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

  const data = await vertexGenerateContent(
    model.id,
    {
      contents: [{ role: 'user', parts }],
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    },
    ctx.logContext,
  );
  const usage = data.usageMetadata ?? {};
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    inputTokens: usage.promptTokenCount ?? 0,
    // Thinking tokens bill at the output rate.
    outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  };
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
