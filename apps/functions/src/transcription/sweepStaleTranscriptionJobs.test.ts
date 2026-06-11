import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in sweepStaleTranscriptionJobs.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const {
  STALE_JOB_ERROR,
  STALE_JOB_MAX_AGE_MS,
  COMPLETED_JOB_RETENTION_DAYS,
  isStaleTranscriptionJob,
  isCompletedJobPrunable,
} = await import('./sweepStaleTranscriptionJobs.js');

const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const minutesAgo = (minutes: number): Timestamp => Timestamp.fromMillis(NOW - minutes * 60_000);
const daysAgo = (days: number): Timestamp => Timestamp.fromMillis(NOW - days * 24 * 60 * 60 * 1000);

describe('isStaleTranscriptionJob (sweep cutoff + in-flight age filter)', () => {
  it('keeps a just-created job', () => {
    expect(isStaleTranscriptionJob(minutesAgo(0), NOW)).toBe(false);
  });

  it('keeps a job still inside the worker lifecycle (9-minute timeout)', () => {
    expect(isStaleTranscriptionJob(minutesAgo(9), NOW)).toBe(false);
  });

  it('keeps a job just under the threshold', () => {
    expect(isStaleTranscriptionJob(minutesAgo(59), NOW)).toBe(false);
  });

  it('marks a job exactly at the threshold as stale', () => {
    expect(isStaleTranscriptionJob(minutesAgo(60), NOW)).toBe(true);
  });

  it('marks a job hours past the threshold as stale', () => {
    expect(isStaleTranscriptionJob(minutesAgo(8 * 60), NOW)).toBe(true);
  });

  it('treats a missing createdAt as stale so it can never block re-transcription', () => {
    expect(isStaleTranscriptionJob(null, NOW)).toBe(true);
    expect(isStaleTranscriptionJob(undefined, NOW)).toBe(true);
  });
});

describe('isCompletedJobPrunable (retention window check)', () => {
  it('keeps a just-completed job', () => {
    expect(isCompletedJobPrunable(daysAgo(0), NOW)).toBe(false);
  });

  it('keeps a job completed weeks ago', () => {
    expect(isCompletedJobPrunable(daysAgo(30), NOW)).toBe(false);
  });

  it('keeps a job just under the retention threshold', () => {
    expect(isCompletedJobPrunable(daysAgo(COMPLETED_JOB_RETENTION_DAYS - 1), NOW)).toBe(false);
  });

  it('marks a job exactly at the retention threshold as prunable', () => {
    expect(isCompletedJobPrunable(daysAgo(COMPLETED_JOB_RETENTION_DAYS), NOW)).toBe(true);
  });

  it('marks a job months past the retention threshold as prunable', () => {
    expect(isCompletedJobPrunable(daysAgo(COMPLETED_JOB_RETENTION_DAYS + 60), NOW)).toBe(true);
  });

  it('treats a missing completedAt as prunable so malformed jobs do not linger', () => {
    expect(isCompletedJobPrunable(null, NOW)).toBe(true);
    expect(isCompletedJobPrunable(undefined, NOW)).toBe(true);
  });
});

describe('sweep constants', () => {
  it('threshold comfortably exceeds the 9-minute worker timeout', () => {
    expect(STALE_JOB_MAX_AGE_MS).toBeGreaterThanOrEqual(540_000 * 2);
  });

  it('error message reports the worker timeout', () => {
    expect(STALE_JOB_ERROR).toMatch(/timed out/i);
  });

  it('retention window is at least 90 days', () => {
    expect(COMPLETED_JOB_RETENTION_DAYS).toBeGreaterThanOrEqual(90);
  });
});
