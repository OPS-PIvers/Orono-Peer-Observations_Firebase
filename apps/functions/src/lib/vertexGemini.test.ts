import { describe, expect, it } from 'vitest';
import { geminiHttpsError } from './vertexGemini.js';

describe('geminiHttpsError', () => {
  it('maps billing/quota failures to a friendly resource-exhausted error', () => {
    const raw =
      '{"error":{"code":402,"message":"Your prepayment credits are depleted. Go to AI Studio","status":"RESOURCE_EXHAUSTED"}}';
    const cases: [number, string][] = [
      [402, raw],
      [429, ''],
      [500, raw],
    ];
    for (const [status, body] of cases) {
      const err = geminiHttpsError(status, body);
      expect(err.code).toBe('resource-exhausted');
      expect(err.message).not.toMatch(/prepayment|AI Studio|RESOURCE_EXHAUSTED/);
    }
  });

  it('maps auth / not-found failures to a setup error', () => {
    for (const status of [401, 403, 404]) {
      expect(geminiHttpsError(status, '').code).toBe('failed-precondition');
    }
  });

  it('maps anything else to a generic internal error without provider text', () => {
    const err = geminiHttpsError(503, 'upstream melted');
    expect(err.code).toBe('internal');
    expect(err.message).not.toContain('upstream melted');
  });
});
