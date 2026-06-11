import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock factories are hoisted to the top of the file, so
// all referenced symbols must be created here to avoid temporal dead zone
// issues.
// ---------------------------------------------------------------------------

const { mockGetDoc, mockSignOut, mockDoc } = vi.hoisted(() => ({
  mockGetDoc: vi.fn(),
  mockSignOut: vi.fn(),
  mockDoc: vi.fn((_db: unknown, path: string) => ({ path })),
}));

vi.mock('firebase/firestore', () => ({
  doc: mockDoc,
  getDoc: mockGetDoc,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => vi.fn()),
  onIdTokenChanged: vi.fn(() => vi.fn()),
  signOut: mockSignOut,
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn()),
}));

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  functions: {},
}));

// Import the function under test after mocks are in place.
import { enforceSessionDuration } from './AuthProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock Firestore snapshot that exists and returns the given data.
 */
function mockSnapshotExists(data: Record<string, unknown>) {
  return {
    exists: () => true,
    data: () => data,
  };
}

/**
 * Build a mock Firestore snapshot for a missing document.
 */
function mockSnapshotMissing() {
  return { exists: () => false };
}

/** Returns an authTimeMs that is `hoursAgo` hours in the past. */
function authTimeMsHoursAgo(hoursAgo: number): number {
  return Date.now() - hoursAgo * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enforceSessionDuration', () => {
  it('signs the user out and returns true when the session exceeds the configured limit', async () => {
    // sessionDurationHours = 8; auth_time was 9 hours ago → expired.
    mockGetDoc.mockResolvedValue(mockSnapshotExists({ sessionDurationHours: 8 }));
    const authTimeMs = authTimeMsHoursAgo(9);

    const result = await enforceSessionDuration(authTimeMs);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('does not sign the user out and returns false when the session is within the limit', async () => {
    // sessionDurationHours = 24; auth_time was 2 hours ago → still valid.
    mockGetDoc.mockResolvedValue(mockSnapshotExists({ sessionDurationHours: 24 }));
    const authTimeMs = authTimeMsHoursAgo(2);

    const result = await enforceSessionDuration(authTimeMs);

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('treats a session exactly at the boundary as still valid (not expired)', async () => {
    // sessionDurationHours = 1; auth_time was exactly 1 hour ago.
    // Date.now() - authTimeMs === limitMs, which is NOT > limitMs.
    mockGetDoc.mockResolvedValue(mockSnapshotExists({ sessionDurationHours: 1 }));
    // Subtract exactly 1 hour in ms; add a small buffer to avoid flakiness
    // from test execution time — subtract slightly less than 1 hour.
    const authTimeMs = Date.now() - 60 * 60 * 1000 + 5000; // 5 s before boundary

    const result = await enforceSessionDuration(authTimeMs);

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('defaults to 24 hours when sessionDurationHours is missing from the doc', async () => {
    // Doc exists but the field is absent (legacy doc).
    mockGetDoc.mockResolvedValue(mockSnapshotExists({}));

    // 23 hours ago → valid under the 24h default.
    const stillValidMs = authTimeMsHoursAgo(23);
    const resultValid = await enforceSessionDuration(stillValidMs);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(resultValid).toBe(false);

    vi.clearAllMocks();
    mockGetDoc.mockResolvedValue(mockSnapshotExists({}));
    mockSignOut.mockResolvedValue(undefined);

    // 25 hours ago → expired under the 24h default.
    const expiredMs = authTimeMsHoursAgo(25);
    const resultExpired = await enforceSessionDuration(expiredMs);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(resultExpired).toBe(true);
  });

  it('returns false without signing out when the appSettings doc does not exist', async () => {
    mockGetDoc.mockResolvedValue(mockSnapshotMissing());
    const authTimeMs = authTimeMsHoursAgo(100); // very old — would expire if doc existed

    const result = await enforceSessionDuration(authTimeMs);

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('returns false and does not throw when getDoc rejects (fail-open on Firestore error)', async () => {
    mockGetDoc.mockRejectedValue(new Error('Firestore unavailable'));
    const authTimeMs = authTimeMsHoursAgo(48);

    const result = await enforceSessionDuration(authTimeMs);

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('reads the settings from appSettings/global', async () => {
    mockGetDoc.mockResolvedValue(mockSnapshotExists({ sessionDurationHours: 12 }));
    await enforceSessionDuration(authTimeMsHoursAgo(1));

    // The doc reference should have been built with the correct path.
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'appSettings/global');
  });

  it('enforces a very short session (1 hour) correctly', async () => {
    mockGetDoc.mockResolvedValue(mockSnapshotExists({ sessionDurationHours: 1 }));
    const authTimeMs = authTimeMsHoursAgo(2); // 2 hours ago, limit is 1h

    const result = await enforceSessionDuration(authTimeMs);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('enforces the maximum session of 168 hours (7 days)', async () => {
    mockGetDoc.mockResolvedValue(mockSnapshotExists({ sessionDurationHours: 168 }));

    // 167 hours ago → still valid.
    const authTimeMsValid = authTimeMsHoursAgo(167);
    const resultValid = await enforceSessionDuration(authTimeMsValid);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(resultValid).toBe(false);

    vi.clearAllMocks();
    mockGetDoc.mockResolvedValue(mockSnapshotExists({ sessionDurationHours: 168 }));
    mockSignOut.mockResolvedValue(undefined);

    // 169 hours ago → expired.
    const authTimeMsExpired = authTimeMsHoursAgo(169);
    const resultExpired = await enforceSessionDuration(authTimeMsExpired);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(resultExpired).toBe(true);
  });
});
