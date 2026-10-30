import { describe, expect, it, vi } from 'vitest';
import { resolveAiModels } from '@ops/shared';

const h = vi.hoisted(() => ({ vertexGenerateContent: vi.fn() }));

vi.mock('firebase-functions', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => '' }) }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => n, serverTimestamp: () => null },
  // Usage metering is best-effort; failing here exercises that path.
  getFirestore: () => {
    throw new Error('no firestore in unit tests');
  },
}));
vi.mock('./vertexGemini.js', () => ({
  vertexGenerateContent: h.vertexGenerateContent,
  geminiHttpsError: vi.fn(),
}));

import { HttpsError } from 'firebase-functions/v2/https';
import { generateTextResult, lowestThinkingLevel } from './aiClient.js';

const gemini = resolveAiModels(undefined).find((m) => m.provider === 'gemini');
if (!gemini) throw new Error('no default Gemini model');
const CTX = { feature: 'audioTranscription' as const, logContext: 'test' };

describe('generateTextResult (Gemini)', () => {
  it('joins every answer part, skipping thought summaries', async () => {
    h.vertexGenerateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: 'plan', thought: true }, { text: 'Hello ' }, { text: 'world' }],
          },
          finishReason: 'STOP',
        },
      ],
    });
    expect(await generateTextResult(gemini, { prompt: 'p' }, CTX)).toEqual({
      text: 'Hello world',
      truncated: false,
    });
  });

  it('reports an answer cut off at the output limit', async () => {
    h.vertexGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: '[{"t":' }] }, finishReason: 'MAX_TOKENS' }],
    });
    expect((await generateTextResult(gemini, { prompt: 'p' }, CTX)).truncated).toBe(true);
  });
});

const OK = { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] };
const sentConfig = (call: number) =>
  (h.vertexGenerateContent.mock.calls[call]?.[1] as { generationConfig?: Record<string, unknown> })
    .generationConfig;

describe('minimalThinking', () => {
  it('asks Flash models for minimal thinking', async () => {
    h.vertexGenerateContent.mockReset().mockResolvedValue(OK);
    await generateTextResult(gemini, { prompt: 'p', temperature: 0, minimalThinking: true }, CTX);
    expect(sentConfig(0)).toEqual({ temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } });
  });

  it('sends no thinking config unless asked', async () => {
    h.vertexGenerateContent.mockReset().mockResolvedValue(OK);
    await generateTextResult(gemini, { prompt: 'p' }, CTX);
    expect(sentConfig(0)).toBeUndefined();
  });

  it('retries without it when the model rejects the request', async () => {
    h.vertexGenerateContent
      .mockReset()
      .mockRejectedValueOnce(new HttpsError('internal', 'bad request'))
      .mockResolvedValue(OK);
    const result = await generateTextResult(gemini, { prompt: 'p', minimalThinking: true }, CTX);
    expect(result.text).toBe('ok');
    expect(sentConfig(1)).toBeUndefined();
  });

  it('does not retry quota errors', async () => {
    h.vertexGenerateContent
      .mockReset()
      .mockRejectedValue(new HttpsError('resource-exhausted', 'quota'));
    await expect(
      generateTextResult(gemini, { prompt: 'p', minimalThinking: true }, CTX),
    ).rejects.toThrow('quota');
    expect(h.vertexGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('picks the lowest level each model family accepts', () => {
    expect(lowestThinkingLevel('gemini-3.5-flash-lite')).toBe('minimal');
    expect(lowestThinkingLevel('gemini-3.5-flash')).toBe('minimal');
    expect(lowestThinkingLevel('gemini-3.1-pro-preview')).toBe('low');
    expect(lowestThinkingLevel('gemini-2.5-flash')).toBeNull();
  });
});
