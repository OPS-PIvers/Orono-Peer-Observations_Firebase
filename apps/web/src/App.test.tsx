import { describe, expect, it } from 'vitest';
import { isSpecialRole } from '@ops/shared';

/**
 * Smoke test — confirms the test stack runs and the workspace import resolves
 * end-to-end (Vite alias + @ops/shared). Real component tests land in Phase 4.
 */
describe('shared package wiring', () => {
  it('detects special-access roles', () => {
    expect(isSpecialRole('Administrator')).toBe(true);
    expect(isSpecialRole('Peer Evaluator')).toBe(true);
    expect(isSpecialRole('Full Access')).toBe(true);
    expect(isSpecialRole('Teacher')).toBe(false);
    expect(isSpecialRole(null)).toBe(false);
  });
});
