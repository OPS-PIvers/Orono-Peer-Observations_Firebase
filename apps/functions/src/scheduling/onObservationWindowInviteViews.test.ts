import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// In-memory window + views; batch ops apply to `views` on commit.
interface State {
  window: Record<string, unknown> | undefined;
  views: Map<string, Record<string, unknown>>;
  commits: number;
}
const state = vi.hoisted((): State => ({ window: undefined, views: new Map(), commits: 0 }));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => {
  const viewRef = (id: string) => ({ id });
  return {
    FieldValue: { serverTimestamp: () => 'SERVER_TS' },
    getFirestore: () => ({
      collection: (name: string) =>
        name === 'windowInviteViews'
          ? {
              doc: viewRef,
              where: (_f: string, _op: string, windowId: string) => ({
                get: () =>
                  Promise.resolve({
                    docs: [...state.views]
                      .filter(([, v]) => v['windowId'] === windowId)
                      .map(([id, v]) => ({ id, data: () => v })),
                  }),
              }),
            }
          : { doc: () => ({ get: () => Promise.resolve({ data: () => state.window }) }) },
      batch: () => {
        const ops: (() => void)[] = [];
        return {
          set: (ref: { id: string }, data: Record<string, unknown>) =>
            ops.push(() => state.views.set(ref.id, data)),
          delete: (ref: { id: string }) => ops.push(() => state.views.delete(ref.id)),
          commit: () => {
            ops.forEach((op) => op());
            state.commits += 1;
            return Promise.resolve();
          },
        };
      },
    }),
  };
});

const { handleWindowInviteViews, syncWindowInviteViews } =
  await import('./onObservationWindowInviteViews.js');
const { getFirestore } = await import('firebase-admin/firestore');

type Doc = Record<string, unknown> | null;
function write(before: Doc, after: Doc) {
  state.window = after ?? undefined;
  return (handleWindowInviteViews as unknown as (e: unknown) => Promise<void>)({
    params: { windowId: 'w1' },
    data: {
      before: { data: () => before ?? undefined },
      after: { data: () => after ?? undefined },
    },
  });
}

const inv = (email: string, over: Record<string, unknown> = {}) => ({
  email,
  name: email,
  role: 'Teacher',
  year: 4,
  buildings: ['oms'],
  buildingId: 'oms',
  inviteToken: `tok-${email}`,
  inviteSentAt: null,
  bookedSlotId: null,
  ...over,
});
const JANE = 'jane@orono.k12.mn.us';
const SAM = 'sam@orono.k12.mn.us';
const win = (over: Record<string, unknown> = {}) => ({
  windowId: 'w1',
  observerEmail: 'pe@orono.k12.mn.us',
  observerName: 'Pat',
  bookingMode: 'direct',
  status: 'open',
  startDate: '2026-11-02',
  endDate: '2026-11-20',
  invitedEmails: [JANE, SAM],
  invitees: [inv(JANE), inv(SAM)],
  peBusyIntervals: [],
  ...over,
});

beforeEach(() => {
  state.window = undefined;
  state.views = new Map();
  state.commits = 0;
});

describe('onObservationWindowInviteViews', () => {
  it('creates one view per invitee on window create', async () => {
    await write(null, win());
    expect([...state.views.keys()].sort()).toEqual([`w1_${JANE}`, `w1_${SAM}`]);
    expect(state.views.get(`w1_${JANE}`)).toMatchObject({
      email: JANE,
      entries: [{ buildingId: 'oms', inviteToken: `tok-${JANE}`, bookedSlotId: null }],
      updatedAt: 'SERVER_TS',
    });
  });

  it('rewrites only the booking invitee’s view when they book', async () => {
    await write(null, win());
    const samBefore = state.views.get(`w1_${SAM}`);
    await write(
      win(),
      win({
        status: 'partially-booked',
        invitees: [inv(JANE, { bookedSlotId: 's1' }), inv(SAM)],
        peBusyIntervals: [{ slotId: 's1' }],
      }),
    );
    expect(state.views.get(`w1_${JANE}`)?.['entries']).toEqual([
      { buildingId: 'oms', inviteToken: `tok-${JANE}`, bookedSlotId: 's1' },
    ]);
    // Status changed for everyone, so Sam's view is rewritten too, but never
    // with Jane's booking.
    expect(state.views.get(`w1_${SAM}`)).toMatchObject({ status: 'partially-booked' });
    expect(JSON.stringify(state.views.get(`w1_${SAM}`))).not.toContain('s1');
    expect(samBefore).toBeDefined();
  });

  it('skips writes that change nothing invitees see', async () => {
    await write(null, win());
    state.commits = 0;
    await write(win(), win({ peBusyIntervals: [{ slotId: 'x' }], updatedAt: 'later' }));
    expect(state.commits).toBe(0);
  });

  it('deletes the view of a removed invitee', async () => {
    await write(null, win());
    await write(win(), win({ invitedEmails: [JANE], invitees: [inv(JANE)] }));
    expect([...state.views.keys()]).toEqual([`w1_${JANE}`]);
  });

  it('deletes every view when the window is deleted', async () => {
    await write(null, win());
    await write(win(), null);
    expect(state.views.size).toBe(0);
  });

  it('syncs against the current window, not a stale event', async () => {
    await write(null, win());
    // A late event still carrying Sam, arriving after Sam was removed.
    state.window = win({ invitedEmails: [JANE], invitees: [inv(JANE)] });
    await (handleWindowInviteViews as unknown as (e: unknown) => Promise<void>)({
      params: { windowId: 'w1' },
      data: {
        before: { data: () => undefined },
        after: { data: () => win() },
      },
    });
    expect([...state.views.keys()]).toEqual([`w1_${JANE}`]);
  });

  it('dry run counts without writing', async () => {
    state.window = win();
    const res = await syncWindowInviteViews(getFirestore(), 'w1', { dryRun: true });
    expect(res).toEqual({ written: 2, deleted: 0 });
    expect(state.views.size).toBe(0);
  });

  it('ignores a malformed window without throwing', async () => {
    await write(null, { observerEmail: 'x', invitees: 1 });
    expect(state.views.size).toBe(0);
  });
});
