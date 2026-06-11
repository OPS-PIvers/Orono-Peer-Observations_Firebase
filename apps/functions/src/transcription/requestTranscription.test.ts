import { describe, expect, it } from 'vitest';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const { assertObservationTranscribable } = await import('./requestTranscription.js');
const { shouldAbortTranscriptionWrite } = await import('./onTranscriptionJobCreated.js');

// ---------------------------------------------------------------------------
// assertObservationTranscribable
// ---------------------------------------------------------------------------

const draftObs = {
  observerEmail: 'pe@orono.k12.mn.us',
  audioDriveFileIds: ['file-1', 'file-2'],
  status: 'Draft',
};
const opts = { userEmail: 'pe@orono.k12.mn.us', audioFileId: 'file-1' };

describe('assertObservationTranscribable', () => {
  it('passes for a Draft observation owned by the caller with a matching audio file', () => {
    expect(() => assertObservationTranscribable(draftObs, opts)).not.toThrow();
  });

  it('throws permission-denied when the caller is not the observer', () => {
    expect(() =>
      assertObservationTranscribable(draftObs, { ...opts, userEmail: 'other@orono.k12.mn.us' }),
    ).toThrow(/not your observation/i);
  });

  it('throws failed-precondition when the observation is Finalized', () => {
    expect(() =>
      assertObservationTranscribable({ ...draftObs, status: 'Finalized' }, opts),
    ).toThrow(/draft observations/i);
  });

  it('throws failed-precondition for any non-Draft status (e.g. legacy states)', () => {
    for (const status of ['Finalized', 'Archived', 'PendingReview']) {
      expect(() => assertObservationTranscribable({ ...draftObs, status }, opts)).toThrow(
        /draft observations/i,
      );
    }
  });

  it('throws not-found when the audio file is not part of the observation', () => {
    expect(() =>
      assertObservationTranscribable(draftObs, { ...opts, audioFileId: 'file-99' }),
    ).toThrow(/not part of this observation/i);
  });

  it('throws permission-denied before failed-precondition (permission check first)', () => {
    // Wrong user AND finalized — should throw the permission error, not the
    // status error, because the caller is checked before the status.
    expect(() =>
      assertObservationTranscribable(
        { ...draftObs, status: 'Finalized' },
        { ...opts, userEmail: 'other@orono.k12.mn.us' },
      ),
    ).toThrow(/not your observation/i);
  });
});

// ---------------------------------------------------------------------------
// shouldAbortTranscriptionWrite
// ---------------------------------------------------------------------------

describe('shouldAbortTranscriptionWrite', () => {
  it('returns false for an existing Draft observation — worker should proceed', () => {
    expect(shouldAbortTranscriptionWrite(true, 'Draft')).toBe(false);
  });

  it('returns true when the observation does not exist', () => {
    expect(shouldAbortTranscriptionWrite(false, undefined)).toBe(true);
  });

  it('returns true when the observation is Finalized', () => {
    expect(shouldAbortTranscriptionWrite(true, 'Finalized')).toBe(true);
  });

  it('returns true for any non-Draft status', () => {
    for (const status of ['Finalized', 'Archived', 'PendingReview']) {
      expect(shouldAbortTranscriptionWrite(true, status)).toBe(true);
    }
  });

  it('returns true when status is undefined (malformed doc)', () => {
    expect(shouldAbortTranscriptionWrite(true, undefined)).toBe(true);
  });
});
