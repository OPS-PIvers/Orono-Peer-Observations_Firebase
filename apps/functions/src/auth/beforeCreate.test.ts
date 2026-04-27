import { describe, expect, it } from 'vitest';
import { ALLOWED_EMAIL_DOMAIN } from '@ops/shared';

/**
 * Phase 1 smoke test — the actual blocking-function behavior is covered by
 * Firestore rules tests + manual verification (sign in with a non-Orono
 * Google account). Functions framework testing lands in Phase 6 once we
 * have observation-lifecycle functions to test.
 */
describe('auth beforeCreate', () => {
  it('uses the orono.k12.mn.us domain constant', () => {
    expect(ALLOWED_EMAIL_DOMAIN).toBe('orono.k12.mn.us');
  });
});
