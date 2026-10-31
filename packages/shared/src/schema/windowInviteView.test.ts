import { describe, expect, it } from 'vitest';
import { windowInviteViewId, windowInviteViewsOf } from './windowInviteView.js';

const invitee = (over: Record<string, unknown> = {}) => ({
  email: 'jane@orono.k12.mn.us',
  name: 'Jane Doe',
  role: 'Teacher',
  year: 4,
  buildings: ['oms', 'ohs'],
  buildingId: 'oms',
  inviteToken: 'tok-jane',
  inviteSentAt: null,
  bookedSlotId: null,
  ...over,
});

const window = (over: Record<string, unknown> = {}) => ({
  windowId: 'w1',
  observerEmail: 'pe@orono.k12.mn.us',
  observerName: 'Pat Evaluator',
  bookingMode: 'direct',
  status: 'open',
  startDate: '2026-11-02',
  endDate: '2026-11-20',
  weekdaysIncluded: [1, 2, 3, 4, 5],
  perDayCap: null,
  dayCounts: { '2026-11-03': 2 },
  invitedEmails: ['jane@orono.k12.mn.us', 'sam@orono.k12.mn.us'],
  invitees: [
    invitee(),
    invitee({
      email: 'sam@orono.k12.mn.us',
      name: 'Sam Smith',
      year: 1,
      inviteToken: 'tok-sam',
      bookedSlotId: 'oms-2026-11-03-p1',
    }),
  ],
  peBusyIntervals: [{ startUTC: 'x', endUTC: 'y', slotId: 'oms-2026-11-03-p1' }],
  signupFieldIds: ['f1'],
  calendarEventDescription: 'private notes',
  ...over,
});

describe('windowInviteViewsOf', () => {
  it('gives each invitee only their own entry and no co-invitee data', () => {
    const views = windowInviteViewsOf(window(), 'w1');
    expect([...views.keys()]).toEqual([
      windowInviteViewId('w1', 'jane@orono.k12.mn.us'),
      windowInviteViewId('w1', 'sam@orono.k12.mn.us'),
    ]);

    const jane = views.get('w1_jane@orono.k12.mn.us');
    expect(jane).toEqual({
      windowId: 'w1',
      email: 'jane@orono.k12.mn.us',
      observerEmail: 'pe@orono.k12.mn.us',
      observerName: 'Pat Evaluator',
      bookingMode: 'direct',
      status: 'open',
      startDate: '2026-11-02',
      endDate: '2026-11-20',
      weekdaysIncluded: [1, 2, 3, 4, 5],
      perDayCap: null,
      dayCounts: { '2026-11-03': 2 },
      entries: [{ buildingId: 'oms', inviteToken: 'tok-jane', bookedSlotId: null }],
    });
    const serialized = JSON.stringify(jane);
    for (const leak of ['sam@', 'Sam Smith', 'tok-sam', 'oms-2026-11-03-p1', 'Teacher', 'ohs']) {
      expect(serialized).not.toContain(leak);
    }
  });

  it('groups one email invited at two buildings into one view with two entries', () => {
    const views = windowInviteViewsOf(
      window({
        invitees: [invitee(), invitee({ buildingId: 'ohs', inviteToken: 'tok-jane-ohs' })],
      }),
      'w1',
    );
    expect(views.size).toBe(1);
    expect(views.get('w1_jane@orono.k12.mn.us')?.['entries']).toEqual([
      { buildingId: 'oms', inviteToken: 'tok-jane', bookedSlotId: null },
      { buildingId: 'ohs', inviteToken: 'tok-jane-ohs', bookedSlotId: null },
    ]);
  });

  it('lowercases emails and drops malformed entries', () => {
    const views = windowInviteViewsOf(
      window({ invitees: [invitee({ email: 'Jane@Orono.k12.mn.us' }), null, 1, { email: 'x' }] }),
      'w1',
    );
    expect([...views.keys()]).toEqual(['w1_jane@orono.k12.mn.us']);
  });

  it('returns no views for a window with no usable invitees', () => {
    expect(windowInviteViewsOf(window({ invitees: 1 }), 'w1').size).toBe(0);
    expect(windowInviteViewsOf({}, 'w1').size).toBe(0);
  });
});
