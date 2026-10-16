import { describe, expect, it } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { releaseForCancelledBooking } = await import('./cancelBooking.js');

/** The Draft bookObservationSlot creates for a booking. */
const freshBooking = {
  status: 'Draft',
  observationData: {},
  componentNotes: {},
  componentTags: [],
  audioDriveFileIds: [],
  workProductAnswers: [],
  pdfDriveFileId: null,
  driveFolderId: null,
  slotId: 'slot1',
};
const text = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});

describe('releaseForCancelledBooking', () => {
  it('deletes a Draft nobody has written on yet', () => {
    expect(releaseForCancelledBooking(freshBooking)).toBe('delete');
  });

  it("keeps (unlinks) a Draft with the evaluator's work on it", () => {
    expect(
      releaseForCancelledBooking({
        ...freshBooking,
        observationData: { c1: { proficiency: 'proficient', selectedLookForIds: [] } },
      }),
    ).toBe('unlink');
    expect(releaseForCancelledBooking({ ...freshBooking, scriptDoc: text('notes') })).toBe(
      'unlink',
    );
    expect(releaseForCancelledBooking({ ...freshBooking, audioDriveFileIds: ['a1'] })).toBe(
      'unlink',
    );
  });

  it("keeps (unlinks) a Draft with the teacher's answers on it", () => {
    expect(
      releaseForCancelledBooking({
        ...freshBooking,
        workProductAnswers: [{ questionId: 'q1', answer: text('my plan') }],
      }),
    ).toBe('unlink');
  });

  it('keeps (unlinks) a reopened observation, which already has a PDF', () => {
    expect(
      releaseForCancelledBooking({ ...freshBooking, pdfDriveFileId: 'pdf1', driveFolderId: 'f1' }),
    ).toBe('unlink');
  });

  it('keeps (unlinks) a Draft that is being finalized', () => {
    expect(releaseForCancelledBooking({ ...freshBooking, finalizeStartedAt: new Date() })).toBe(
      'unlink',
    );
  });

  it('leaves a Finalized observation alone', () => {
    expect(releaseForCancelledBooking({ ...freshBooking, status: 'Finalized' })).toBe('leave');
  });
});
