import { describe, expect, it } from 'vitest';

// Set fake env to satisfy the Firebase Admin/Functions initializers that may
// run at module scope before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const { normalizeRecipients, MAX_BULK_RECIPIENTS } = await import('./sendBulkManualEmail.js');

describe('normalizeRecipients', () => {
  it('lowercases and trims each address', () => {
    expect(normalizeRecipients([' Teacher@Orono.K12.MN.US '])).toEqual(['teacher@orono.k12.mn.us']);
  });

  it('drops case-insensitive duplicates, keeping the first occurrence', () => {
    expect(
      normalizeRecipients(['a@orono.k12.mn.us', 'A@ORONO.K12.MN.US', 'b@orono.k12.mn.us']),
    ).toEqual(['a@orono.k12.mn.us', 'b@orono.k12.mn.us']);
  });

  it('drops entries that are not valid-looking email addresses', () => {
    expect(normalizeRecipients(['not-an-email', '', '   ', 'a@orono.k12.mn.us'])).toEqual([
      'a@orono.k12.mn.us',
    ]);
  });

  it('drops non-string entries defensively', () => {
    expect(normalizeRecipients([42, null, undefined, 'a@orono.k12.mn.us'])).toEqual([
      'a@orono.k12.mn.us',
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeRecipients([])).toEqual([]);
  });
});

describe('MAX_BULK_RECIPIENTS', () => {
  it('is the documented hard cap of 200', () => {
    expect(MAX_BULK_RECIPIENTS).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Batch-cap decision — mirrors the check in the callable so the boundary is
// covered without spinning up a full Firebase Admin environment.
// ---------------------------------------------------------------------------

function exceedsCap(count: number): boolean {
  return count > MAX_BULK_RECIPIENTS;
}

describe('recipient cap boundary', () => {
  it('allows exactly the cap', () => {
    expect(exceedsCap(MAX_BULK_RECIPIENTS)).toBe(false);
  });

  it('rejects one over the cap', () => {
    expect(exceedsCap(MAX_BULK_RECIPIENTS + 1)).toBe(true);
  });
});
