import { describe, expect, it, vi } from 'vitest';
import { resolveAiModels } from '@ops/shared';

const h = vi.hoisted(() => ({ vertexGenerateContent: vi.fn() }));

vi.mock('firebase-functions', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
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

import { generateTextResult } from './aiClient.js';

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
