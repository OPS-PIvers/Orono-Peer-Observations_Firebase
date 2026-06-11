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

import {
  formatAckLabel,
  formatRelative,
  hasMoreObservations,
  nextObservationsPageSize,
  observationsCapNotice,
} from './ObservationsListPage';

describe('hasMoreObservations', () => {
  it('is false while the loaded count is below the query window', () => {
    expect(hasMoreObservations(0, 200)).toBe(false);
    expect(hasMoreObservations(199, 200)).toBe(false);
  });

  it('is true once the loaded count fills the query window', () => {
    expect(hasMoreObservations(200, 200)).toBe(true);
    expect(hasMoreObservations(400, 400)).toBe(true);
  });
});

describe('nextObservationsPageSize', () => {
  it('widens the window by one page step per call', () => {
    expect(nextObservationsPageSize(200, 200)).toBe(400);
    expect(nextObservationsPageSize(400, 200)).toBe(600);
  });
});

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

  it('is honest that search only covers the loaded window and points at load more', () => {
    const notice = observationsCapNotice(200, 200);
    expect(notice).toMatch(/search only filters these loaded results/i);
    expect(notice).toMatch(/load more/i);
    expect(notice).not.toMatch(/search to reach older/i);
  });

  it('reflects a widened window after load-more clicks', () => {
    expect(observationsCapNotice(400, 400)).toContain('400');
    expect(observationsCapNotice(399, 400)).toBeNull();
  });
});

describe('formatAckLabel', () => {
  it('returns null for null (not yet acknowledged)', () => {
    expect(formatAckLabel(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(formatAckLabel(undefined as unknown as null)).toBeNull();
  });

  it('formats a JS Date with a locale date prefix', () => {
    const label = formatAckLabel(new Date('2026-05-15T10:00:00.000Z'));
    expect(label).not.toBeNull();
    expect(label).toMatch(/^Acknowledged /);
  });

  it('formats a Firestore Timestamp-like via .toDate()', () => {
    const ts = { toDate: () => new Date('2026-05-15T10:00:00.000Z') };
    const label = formatAckLabel(ts as unknown as Date);
    expect(label).not.toBeNull();
    expect(label).toMatch(/^Acknowledged /);
  });

  it('formats an ISO date string', () => {
    const label = formatAckLabel('2026-05-15T10:00:00.000Z' as unknown as Date);
    expect(label).not.toBeNull();
    expect(label).toMatch(/^Acknowledged /);
  });

  it('returns null for an unparseable value', () => {
    expect(formatAckLabel('not-a-date' as unknown as Date)).toBeNull();
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
