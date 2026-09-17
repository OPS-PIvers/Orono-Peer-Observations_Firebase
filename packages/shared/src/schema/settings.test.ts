import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_OPTIONS,
  canUseGeminiFeature,
  geminiFeature,
  geminiFeatures,
  resolveGeminiFeature,
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

describe('resolveGeminiFeature', () => {
  it('is off with the default model when nothing is stored', () => {
    for (const raw of [undefined, null, {}, 'nonsense']) {
      expect(resolveGeminiFeature(raw)).toEqual({
        access: 'off',
        betaEmails: [],
        model: DEFAULT_GEMINI_MODEL,
      });
    }
  });

  it('keeps a stored access level and beta list', () => {
    expect(
      resolveGeminiFeature({
        access: 'beta',
        betaEmails: ['a@orono.k12.mn.us'],
        model: 'gemini-4-flash',
      }),
    ).toEqual({ access: 'beta', betaEmails: ['a@orono.k12.mn.us'], model: 'gemini-4-flash' });
  });

  // Tenants who saved Settings before access levels existed only have the
  // boolean. Hydration fills betaEmails in alongside it, so both shapes occur.
  it.each([
    [{ enabled: true }, 'all'],
    [{ enabled: false }, 'off'],
    [{ enabled: true, betaEmails: [] }, 'all'],
  ])('maps the legacy flag %o to %s', (raw, access) => {
    expect(resolveGeminiFeature(raw).access).toBe(access);
  });

  it('prefers access over a stale legacy flag', () => {
    expect(resolveGeminiFeature({ enabled: true, access: 'off' }).access).toBe('off');
  });

  it('drops malformed beta entries without resetting the rest', () => {
    expect(
      resolveGeminiFeature({
        access: 'beta',
        betaEmails: ['Ok@Orono.k12.mn.us', 'not-an-email', 42],
      }),
    ).toMatchObject({ access: 'beta', betaEmails: ['ok@orono.k12.mn.us'] });
  });

  it('maps a retired or malformed model to the default', () => {
    expect(resolveGeminiFeature({ model: 'gemini-2.5-pro' }).model).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveGeminiFeature({ model: 'gpt-5' }).model).toBe(DEFAULT_GEMINI_MODEL);
  });
});

describe('canUseGeminiFeature', () => {
  const base = { betaEmails: ['tester@orono.k12.mn.us'], model: DEFAULT_GEMINI_MODEL };

  it('lets nobody in when off, even someone on the beta list', () => {
    expect(canUseGeminiFeature({ ...base, access: 'off' }, 'tester@orono.k12.mn.us')).toBe(false);
  });

  it('lets only listed users in during beta, ignoring case', () => {
    const beta = { ...base, access: 'beta' as const };
    expect(canUseGeminiFeature(beta, 'Tester@Orono.k12.mn.us')).toBe(true);
    expect(canUseGeminiFeature(beta, 'other@orono.k12.mn.us')).toBe(false);
    expect(canUseGeminiFeature(beta, null)).toBe(false);
  });

  it('lets everyone in when on for all', () => {
    expect(canUseGeminiFeature({ ...base, access: 'all' }, 'other@orono.k12.mn.us')).toBe(true);
  });
});
