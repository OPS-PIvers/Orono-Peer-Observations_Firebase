import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
  where: (...args: unknown[]) => ({ type: 'where', args }),
  or: (...filters: unknown[]) => ({ type: 'or', filters }),
  and: (...filters: unknown[]) => ({ type: 'and', filters }),
}));

import { ownDraftGate, withGate } from './ownDraftGate';

const ME = 'me@orono.k12.mn.us';
const finalized = { type: 'where', args: ['status', '==', 'Finalized'] };
const notMe = { type: 'where', args: ['observedEmail', '!=', ME] };

describe('ownDraftGate', () => {
  it('excludes only the reader’s own Drafts from an unnarrowed query', () => {
    expect(ownDraftGate(ME)).toEqual([{ type: 'or', filters: [notMe, finalized] }]);
  });

  it('needs nothing for Finalized or for someone else', () => {
    expect(ownDraftGate(ME, { status: 'Finalized' })).toEqual([]);
    expect(ownDraftGate(ME, { observedEmail: 'other@orono.k12.mn.us' })).toEqual([]);
    expect(ownDraftGate(null)).toEqual([]);
  });

  it('keeps the reader’s own observations to Finalized, whatever the case', () => {
    expect(ownDraftGate(ME, { observedEmail: 'Me@Orono.k12.mn.us' })).toEqual([finalized]);
  });

  it('a Draft status filter just leaves the reader out', () => {
    expect(ownDraftGate(ME, { status: 'Draft' })).toEqual([notMe]);
  });

  it('wraps every filter in and() only for an or() gate', () => {
    const scope = { type: 'where', args: ['observerEmail', '==', 'pe@orono.k12.mn.us'] } as never;
    expect(withGate([scope], [notMe as never])).toEqual([scope, notMe]);
    expect(withGate([scope], ownDraftGate(ME))).toEqual([
      { type: 'and', filters: [scope, { type: 'or', filters: [notMe, finalized] }] },
    ]);
  });
});
