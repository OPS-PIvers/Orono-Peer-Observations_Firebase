import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COLLECTIONS } from '@ops/shared';
import { isProcessableWindow } from './windowShape.js';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// ---------------------------------------------------------------------------
// A planted window doc ('!poison' sorts ahead of every auto-id) must not stop
// the scheduling jobs from processing the real windows after it.
// ---------------------------------------------------------------------------
interface State {
  windows: { id: string; data: Record<string, unknown> }[];
  writes: string[];
  emails: string[];
}
const state = vi.hoisted((): State => ({ windows: [], writes: [], emails: [] }));

function windowRef(id: string) {
  const path = `${COLLECTIONS.observationWindows}/${id}`;
  return {
    id,
    path,
    update: () => {
      state.writes.push(`update ${path}`);
      return Promise.resolve();
    },
    collection: (name: string) => ({
      doc: (slotId: string) => ({ path: `${path}/${name}/${slotId}` }),
      where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
    }),
  };
}

const fakeDb = {
  collection: (name: string) => ({
    where: () => ({
      get: () => {
        const docs = state.windows.map((w) => ({
          id: w.id,
          ref: windowRef(w.id),
          data: () => w.data,
        }));
        return Promise.resolve({ docs, size: docs.length });
      },
    }),
    doc: () => ({
      get: () =>
        Promise.resolve({
          exists: true,
          data: () => ({ scheduling: { inviteEmailEnabled: true } }),
        }),
    }),
    add: () => {
      state.writes.push(`add ${name}`);
      return Promise.resolve({ id: 'new' });
    },
  }),
  batch: () => ({
    set: (ref: { path: string }) => state.writes.push(`batch.set ${ref.path}`),
    update: (ref: { path: string }) => state.writes.push(`batch.update ${ref.path}`),
    commit: () => Promise.resolve(),
  }),
};

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb,
  FieldValue: { serverTimestamp: () => '__server_ts__', arrayUnion: (...v: unknown[]) => v },
}));
vi.mock('../lib/emailUtils.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendTemplatedEmail: vi.fn((args: { to: string }) => {
    state.emails.push(args.to);
    return Promise.resolve(true);
  }),
}));
// One far-future slot per invited building, so a reconciled window shows up
// as a batch.set under its slots subcollection.
vi.mock('./engine/slotGeneration.js', () => ({
  generateSlotsForWindow: (w: { windowId: string; invitees: { buildingId: string }[] }) =>
    w.invitees.map((inv) => ({
      slotId: `${inv.buildingId}-2099-01-05-p1`,
      windowId: w.windowId,
      buildingId: inv.buildingId,
      dateYMD: '2099-01-05',
      startUTC: new Date('2099-01-05T14:00:00Z'),
      endUTC: new Date('2099-01-05T15:00:00Z'),
      startMinute: 480,
      periodName: 'P1',
      dayTypeId: 'regular',
      status: 'available',
    })),
}));

const { expireObservationWindows } = await import('./expireObservationWindows.js');
const { onBuildingScheduleWritten } = await import('./onBuildingScheduleWritten.js');
interface Runnable {
  run: (e: unknown) => Promise<unknown>;
}

const realWindow = (over: Record<string, unknown> = {}) => ({
  windowId: 'aReal1',
  observerEmail: 'pe@orono.k12.mn.us',
  observerName: 'Pat Evaluator',
  status: 'open',
  startDate: '2020-01-01',
  endDate: '2020-01-31',
  invitees: [
    {
      email: 'jane@orono.k12.mn.us',
      name: 'Jane Doe',
      buildingId: 'oms',
      inviteToken: 't',
      bookedSlotId: null,
    },
  ],
  ...over,
});

const POISONS: [string, Record<string, unknown>][] = [
  ['invitees: 1', { invitees: 1 }],
  ['no invitees', {}],
  ['a null invitee', { invitees: [null] }],
];

beforeEach(() => {
  state.windows = [];
  state.writes = [];
  state.emails = [];
});

describe('isProcessableWindow', () => {
  it('accepts a window shaped like createObservationWindow output', () => {
    expect(isProcessableWindow(realWindow())).toBe(true);
  });

  it.each(POISONS)('rejects a window with %s', (_label, over) => {
    expect(
      isProcessableWindow({ observerEmail: 'x', status: 'open', endDate: '2020-01-01', ...over }),
    ).toBe(false);
  });

  it('rejects a window with a non-string endDate', () => {
    expect(isProcessableWindow(realWindow({ endDate: 20200101 }))).toBe(false);
  });
});

describe('expireObservationWindows with a malformed window ahead of a real one', () => {
  it.each(POISONS)('still expires and notifies the real window (%s)', async (_label, over) => {
    state.windows = [
      {
        id: '!poison',
        data: {
          observerEmail: 'pe@orono.k12.mn.us',
          status: 'open',
          endDate: '2020-01-01',
          ...over,
        },
      },
      { id: 'aReal1', data: realWindow() },
    ];

    await (expireObservationWindows as unknown as Runnable).run({});

    expect(state.writes).toContain(`update ${COLLECTIONS.observationWindows}/aReal1`);
    expect(state.writes).not.toContain(`update ${COLLECTIONS.observationWindows}/!poison`);
    expect(state.emails).toEqual(['jane@orono.k12.mn.us']);
    expect(state.writes).toContain(`add ${COLLECTIONS.auditLog}`);
  });
});

describe('onBuildingScheduleWritten with a malformed window ahead of a real one', () => {
  const event = {
    params: { buildingId: 'oms' },
    data: { after: { exists: true, data: () => ({ buildingId: 'oms' }) } },
  };

  it.each(POISONS)('still reconciles the real window (%s)', async (_label, over) => {
    state.windows = [
      {
        id: '!poison',
        data: {
          observerEmail: 'pe@orono.k12.mn.us',
          status: 'open',
          endDate: '2099-12-31',
          ...over,
        },
      },
      { id: 'aReal1', data: realWindow({ endDate: '2099-12-31' }) },
    ];

    await (onBuildingScheduleWritten as unknown as Runnable).run(event);

    expect(state.writes).toEqual([
      `batch.set ${COLLECTIONS.observationWindows}/aReal1/slots/oms-2099-01-05-p1`,
    ]);
  });
});
