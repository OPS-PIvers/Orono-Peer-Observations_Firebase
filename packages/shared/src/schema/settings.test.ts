import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_OPTIONS,
  geminiFeature,
  geminiFeatures,
  resolveGeminiModel,
} from './settings.js';

describe('Gemini model options', () => {
  it('offers exactly one model', () => {
    expect(GEMINI_MODEL_OPTIONS).toHaveLength(1);
    expect(GEMINI_MODEL_OPTIONS[0].id).toBe('gemini-3.5-flash-lite');
  });

  it('defaults to the one option it offers', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
  });

  it('satisfies the schema regex, so a fresh parse round-trips', () => {
    expect(geminiFeature.parse({}).model).toBe(DEFAULT_GEMINI_MODEL);
    expect(geminiFeatures.parse({}).audioTranscription.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(geminiFeatures.parse({}).scriptAutoTag.model).toBe(DEFAULT_GEMINI_MODEL);
  });
});

describe('resolveGeminiModel', () => {
  // The whole point of the retirement list: a tenant who saved Settings under
  // the old menu has one of these in Firestore, and a stored value beats the
  // schema default — without this they would keep getting billed for a model
  // the admin UI no longer offers.
  it.each([
    'gemini-3.1-flash-lite-preview',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
  ])('maps the retired %s forward to the default', (retired) => {
    expect(resolveGeminiModel(retired)).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('falls back to the default for an absent or empty value', () => {
    expect(resolveGeminiModel(undefined)).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveGeminiModel(null)).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveGeminiModel('')).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('leaves the current model alone', () => {
    expect(resolveGeminiModel(DEFAULT_GEMINI_MODEL)).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('passes an unrecognized id through', () => {
    // The escape hatch: an admin can point at a model Google ships after
    // this release without waiting on us.
    expect(resolveGeminiModel('gemini-4-flash')).toBe('gemini-4-flash');
  });
});
