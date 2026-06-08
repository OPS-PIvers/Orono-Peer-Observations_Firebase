import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Importing the page module pulls in @/lib/firebase (which would initialize a
// real Firebase app); stub it so we can exercise the page's pure helpers.
vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

import { formatRelative, observationsCapNotice } from './ObservationsListPage';

describe('observationsCapNotice', () => {
  it('returns null below the cap', () => {
    expect(observationsCapNotice(0, 200)).toBeNull();
    expect(observationsCapNotice(199, 200)).toBeNull();
  });

  it('returns a notice when the loaded count reaches the cap', () => {
    const notice = observationsCapNotice(200, 200);
    expect(notice).toContain('200');
    expect(notice).toMatch(/most recently modified/i);
  });
});

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles JS Date values', () => {
    expect(formatRelative(new Date('2026-06-08T11:59:40.000Z'))).toBe('just now');
    expect(formatRelative(new Date('2026-06-08T11:30:00.000Z'))).toBe('30m ago');
    expect(formatRelative(new Date('2026-06-08T09:00:00.000Z'))).toBe('3h ago');
    expect(formatRelative(new Date('2026-06-05T12:00:00.000Z'))).toBe('3d ago');
  });

  it('coerces Firestore Timestamp-like values via toDate()', () => {
    const ts = { toDate: () => new Date('2026-06-08T11:30:00.000Z') };
    expect(formatRelative(ts as unknown as Date)).toBe('30m ago');
  });

  it('returns an em dash for unparseable values', () => {
    expect(formatRelative(null as unknown as Date)).toBe('—');
  });
});
