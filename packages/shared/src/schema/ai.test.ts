import { describe, expect, it } from 'vitest';
import {
  AI_MODEL_PRESETS,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_MODELS,
  aiModel,
  aiUsageDayKey,
  estimateCostUsd,
  modelFitsFeature,
  providerForModelId,
  resolveAiModels,
  resolveFeatureModel,
  type AiModel,
} from './ai.js';

function preset(id: string): AiModel {
  const found = AI_MODEL_PRESETS.find((m) => m.id === id);
  if (!found) throw new Error(`missing preset ${id}`);
  return found;
}

const haiku = preset('claude-haiku-5-5');
const flash = preset('gemini-3.5-flash');

describe('aiModel', () => {
  it('accepts every preset', () => {
    for (const preset of AI_MODEL_PRESETS) expect(aiModel.safeParse(preset).success).toBe(true);
  });

  it('rejects an id that does not match its provider', () => {
    expect(aiModel.safeParse({ ...haiku, provider: 'gemini' }).success).toBe(false);
    expect(aiModel.safeParse({ ...haiku, id: 'gpt-5' }).success).toBe(false);
  });
});

describe('providerForModelId', () => {
  it('reads the provider from the id prefix', () => {
    expect(providerForModelId('claude-sonnet-5-5')).toBe('claude');
    expect(providerForModelId('gemini-3.5-flash')).toBe('gemini');
    expect(providerForModelId('gpt-5')).toBeNull();
  });
});

describe('resolveAiModels', () => {
  it('falls back to the default list for missing or empty input', () => {
    expect(resolveAiModels(undefined)).toEqual(DEFAULT_AI_MODELS);
    expect(resolveAiModels([])).toEqual(DEFAULT_AI_MODELS);
  });

  it('drops invalid entries and duplicate ids', () => {
    expect(resolveAiModels([haiku, { id: 'nope' }, haiku, flash]).map((m) => m.id)).toEqual([
      'claude-haiku-5-5',
      'gemini-3.5-flash',
    ]);
  });
});

describe('resolveFeatureModel', () => {
  const models = [DEFAULT_AI_MODEL, flash, haiku];

  it('uses the stored model when it fits the feature', () => {
    expect(resolveFeatureModel(models, 'scriptAutoTag', 'claude-haiku-5-5').id).toBe(
      'claude-haiku-5-5',
    );
    expect(resolveFeatureModel(models, 'audioTranscription', 'gemini-3.5-flash').id).toBe(
      'gemini-3.5-flash',
    );
  });

  it('never routes transcription to a text-only model', () => {
    expect(modelFitsFeature(haiku, 'audioTranscription')).toBe(false);
    expect(resolveFeatureModel(models, 'audioTranscription', 'claude-haiku-5-5').id).toBe(
      DEFAULT_AI_MODEL.id,
    );
  });

  it('falls back when the stored model is disabled or missing', () => {
    const disabled = [DEFAULT_AI_MODEL, { ...haiku, enabled: false }];
    expect(resolveFeatureModel(disabled, 'scriptAutoTag', 'claude-haiku-5-5').id).toBe(
      DEFAULT_AI_MODEL.id,
    );
    expect(resolveFeatureModel(models, 'scriptAutoTag', 'gemini-9').id).toBe(DEFAULT_AI_MODEL.id);
  });

  it('falls back to the built-in default when nothing in the list fits', () => {
    expect(resolveFeatureModel([haiku], 'audioTranscription', null)).toEqual(DEFAULT_AI_MODEL);
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output tokens per million', () => {
    expect(estimateCostUsd(haiku, 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(estimateCostUsd(DEFAULT_AI_MODEL, 10_000, 2_000)).toBeCloseTo(0.008);
  });
});

describe('aiUsageDayKey', () => {
  it('uses the district time zone', () => {
    // 03:00 UTC on Oct 13 is still Oct 12 in Minnesota.
    expect(aiUsageDayKey(new Date('2026-10-13T03:00:00Z'))).toBe('2026-10-12');
    expect(aiUsageDayKey(new Date('2026-10-13T15:00:00Z'))).toBe('2026-10-13');
  });
});
