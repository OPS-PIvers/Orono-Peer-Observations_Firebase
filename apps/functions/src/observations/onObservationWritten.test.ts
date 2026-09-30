import { describe, expect, it } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { isNewlyAcknowledged } = await import('./onObservationWritten.js');

describe('isNewlyAcknowledged', () => {
  it('fires only when acknowledgedAt goes from unset to set', () => {
    const at = new Date();
    expect(isNewlyAcknowledged({ acknowledgedAt: null }, { acknowledgedAt: at })).toBe(true);
    expect(isNewlyAcknowledged({}, { acknowledgedAt: at })).toBe(true);
    expect(isNewlyAcknowledged({ acknowledgedAt: at }, { acknowledgedAt: at })).toBe(false);
    expect(isNewlyAcknowledged({ acknowledgedAt: null }, { acknowledgedAt: null })).toBe(false);
    // Reopen clears it; that's not an acknowledgment.
    expect(isNewlyAcknowledged({ acknowledgedAt: at }, { acknowledgedAt: null })).toBe(false);
  });
});
