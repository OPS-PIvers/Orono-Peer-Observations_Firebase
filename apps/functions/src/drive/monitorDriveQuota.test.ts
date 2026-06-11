import { describe, expect, it } from 'vitest';
import {
  parseStorageQuota,
  quotaAlertMailDocId,
  QUOTA_ALERT_THRESHOLD,
} from './monitorDriveQuota.js';

// Set fake env to satisfy Firebase Admin/Functions initializers at module scope.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const GB = 1_073_741_824;

describe('quotaAlertMailDocId', () => {
  it('produces a stable doc id for a given date', () => {
    expect(quotaAlertMailDocId('2026-06-11')).toBe('drive-quota-alert-2026-06-11');
  });

  it('produces different ids for different dates (daily dedupe)', () => {
    expect(quotaAlertMailDocId('2026-06-11')).not.toBe(quotaAlertMailDocId('2026-06-12'));
  });
});

describe('parseStorageQuota', () => {
  it('returns parsed numeric values from string-encoded int64s', () => {
    const result = parseStorageQuota({
      limit: String(15 * GB),
      usage: String(12 * GB),
      usageInDrive: String(10 * GB),
    });
    expect(result).toEqual({
      limitBytes: 15 * GB,
      usageBytes: 12 * GB,
      usageInDriveBytes: 10 * GB,
    });
  });

  it('defaults usageInDriveBytes to 0 when field is absent', () => {
    const result = parseStorageQuota({
      limit: String(15 * GB),
      usage: String(1 * GB),
    });
    expect(result?.usageInDriveBytes).toBe(0);
  });

  it('returns null when limit is missing (Shared Drive pooled context)', () => {
    expect(parseStorageQuota({ limit: null, usage: String(1 * GB) })).toBeNull();
  });

  it('returns null when limit is absent (field not returned by API)', () => {
    expect(parseStorageQuota({ usage: String(1 * GB) })).toBeNull();
  });

  it('returns null when usage is missing', () => {
    expect(parseStorageQuota({ limit: String(15 * GB), usage: null })).toBeNull();
  });

  it('returns null when limit is zero (prevents divide-by-zero in caller)', () => {
    expect(parseStorageQuota({ limit: '0', usage: '0' })).toBeNull();
  });

  it('returns null when limit is not a finite number', () => {
    expect(parseStorageQuota({ limit: 'NaN', usage: '0' })).toBeNull();
  });
});

describe('QUOTA_ALERT_THRESHOLD', () => {
  it('is between 0 and 1 exclusive', () => {
    expect(QUOTA_ALERT_THRESHOLD).toBeGreaterThan(0);
    expect(QUOTA_ALERT_THRESHOLD).toBeLessThan(1);
  });

  it('alerts before the drive is completely full (leaves headroom)', () => {
    // 80% threshold means a 15 GB drive fires at 12 GB, giving 3 GB of headroom.
    const limitBytes = 15 * GB;
    const parsed = parseStorageQuota({
      limit: String(limitBytes),
      usage: String(Math.floor(limitBytes * QUOTA_ALERT_THRESHOLD)),
    });
    if (parsed === null) throw new Error('expected parsed quota to be non-null');
    const fraction = parsed.usageBytes / parsed.limitBytes;
    expect(fraction).toBeGreaterThanOrEqual(QUOTA_ALERT_THRESHOLD);
  });
});
