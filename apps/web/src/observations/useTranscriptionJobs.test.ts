import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { TranscriptionJob } from '@ops/shared';
import { groupLatestJobsByAudioFileId, toMillis } from './transcriptionJobGrouping';

/** `createdAt` is typed `Date` by the shared zod schema, but a raw
 *  Firestore read (what `groupLatestJobsByAudioFileId` actually consumes)
 *  hands back a `Timestamp` or, once serialized, an ISO string — never a
 *  real `Date` instance. Accept an ISO string here to mirror that and cast,
 *  same as the schema-vs-runtime mismatch already tolerated elsewhere
 *  (e.g. AuditLogPage's `instanceof Timestamp` check). */
function job(
  overrides: Partial<Omit<TranscriptionJob, 'createdAt'> & { id: string; createdAt: string }>,
): TranscriptionJob & { id: string } {
  return {
    id: 'job1',
    jobId: 'job1',
    observationId: 'obs1',
    audioDriveFileId: 'file1',
    requestedBy: 'pe@orono.k12.mn.us',
    status: 'Pending',
    startedAt: null,
    completedAt: null,
    error: null,
    transcriptPreview: null,
    geminiFileUri: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  } as unknown as TranscriptionJob & { id: string };
}

describe('toMillis', () => {
  it('reads Firestore Timestamp instances', () => {
    const ts = Timestamp.fromMillis(1_000);
    expect(toMillis(ts)).toBe(1_000);
  });

  it('parses ISO date strings', () => {
    expect(toMillis('2026-07-10T00:00:00.000Z')).toBe(Date.parse('2026-07-10T00:00:00.000Z'));
  });

  it('falls back to 0 for null/unparseable values', () => {
    expect(toMillis(null)).toBe(0);
    expect(toMillis('not-a-date')).toBe(0);
    expect(toMillis(undefined)).toBe(0);
  });
});

describe('groupLatestJobsByAudioFileId', () => {
  it('keeps the most recent job per audio file', () => {
    const older = job({
      id: 'job-old',
      status: 'Failed',
      error: 'boom',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    const newer = job({
      id: 'job-new',
      status: 'Running',
      createdAt: '2026-07-10T00:05:00.000Z',
    });
    const result = groupLatestJobsByAudioFileId([older, newer]);
    expect(result['file1']?.id).toBe('job-new');
    expect(result['file1']?.status).toBe('Running');
  });

  it('keeps jobs for different audio files independent', () => {
    const fileA = job({ id: 'a', audioDriveFileId: 'fileA', status: 'Completed' });
    const fileB = job({ id: 'b', audioDriveFileId: 'fileB', status: 'Failed', error: 'nope' });
    const result = groupLatestJobsByAudioFileId([fileA, fileB]);
    expect(result['fileA']?.id).toBe('a');
    expect(result['fileB']?.id).toBe('b');
  });

  it('returns an empty map for an empty job list', () => {
    expect(groupLatestJobsByAudioFileId([])).toEqual({});
  });

  it('is order-independent for a given pair of timestamps', () => {
    const older = job({ id: 'old', createdAt: '2026-07-01T00:00:00.000Z' });
    const newer = job({ id: 'new', createdAt: '2026-07-05T00:00:00.000Z' });
    expect(groupLatestJobsByAudioFileId([older, newer])['file1']?.id).toBe('new');
    expect(groupLatestJobsByAudioFileId([newer, older])['file1']?.id).toBe('new');
  });
});
