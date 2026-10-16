import { describe, expect, it } from 'vitest';
import { observationHasRecordedContent, observationWasFinalized } from './observation.js';

const text = (t: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
});
const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** What bookObservationSlot creates for a fresh booking. */
const booked = {
  status: 'Draft',
  observationData: {},
  componentNotes: {},
  componentTags: [],
  audioDriveFileIds: [],
  workProductAnswers: [],
  pdfDriveFileId: null,
  driveFolderId: null,
};

describe('observationWasFinalized', () => {
  it('is false for a new draft and true once a PDF exists', () => {
    expect(observationWasFinalized(booked)).toBe(false);
    expect(observationWasFinalized({ ...booked, pdfDriveFileId: '' })).toBe(false);
    expect(observationWasFinalized({ ...booked, pdfDriveFileId: 'pdf1' })).toBe(true);
  });
});

describe('observationHasRecordedContent', () => {
  it('is false for a freshly booked draft, including empty editor docs', () => {
    expect(observationHasRecordedContent(booked)).toBe(false);
    expect(observationHasRecordedContent({})).toBe(false);
    expect(
      observationHasRecordedContent({
        ...booked,
        scriptDoc: emptyDoc,
        componentNotes: { c1: emptyDoc },
        observationData: { c1: { proficiency: null, selectedLookForIds: [], scratchNotes: '  ' } },
        evidenceLinks: { c1: [] },
        workProductAnswers: [{ questionId: 'q1', answer: '' }],
      }),
    ).toBe(false);
  });

  it.each([
    ['a rating', { observationData: { c1: { proficiency: 'proficient' } } }],
    ['a look-for', { observationData: { c1: { selectedLookForIds: ['l1'] } } }],
    ['scratch notes', { observationData: { c1: { scratchNotes: 'note' } } }],
    ['component notes', { componentNotes: { c1: text('notes') } }],
    ['evidence', { evidenceLinks: { c1: [{ fileId: 'f' }] } }],
    ['a script tag', { componentTags: [{ id: 't' }] }],
    ['audio', { audioDriveFileIds: ['a1'] }],
    ['the script', { scriptDoc: text('script') }],
    ['planning notes', { preObsNotes: text('pre') }],
    ['reflection notes', { postObsNotes: text('post') }],
    ['goals notes', { goalsNextSteps: text('goals') }],
    ['the teacher goals response', { goalsResponse: text('mine') }],
    ['a meeting date', { preObsDate: new Date() }],
    ['a legacy string answer', { workProductAnswers: [{ questionId: 'q', answer: 'yes' }] }],
    ['a rich-text answer', { workProductAnswers: [{ questionId: 'q', answer: text('yes') }] }],
    ['a finalized PDF', { pdfDriveFileId: 'pdf1' }],
  ])('is true with %s', (_label, extra) => {
    expect(observationHasRecordedContent({ ...booked, ...extra })).toBe(true);
  });
});
