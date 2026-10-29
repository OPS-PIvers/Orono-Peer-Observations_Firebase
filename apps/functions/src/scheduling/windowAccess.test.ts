import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { COLLECTIONS } from '@ops/shared';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// ---------------------------------------------------------------------------
// Path-keyed fake Firestore. Reads come from `state.docs`; every read path and
// every write is recorded so tests can prove an unauthorized caller neither
// learned anything about the target nor changed anything.
// ---------------------------------------------------------------------------
interface State {
  docs: Record<string, Record<string, unknown>>;
  reads: string[];
  writes: string[];
}
const state = vi.hoisted((): State => ({ docs: {}, reads: [], writes: [] }));

function docRef(path: string): Record<string, unknown> {
  return {
    id: path.split('/').pop(),
    path,
    get: () => {
      state.reads.push(path);
      const data = state.docs[path];
      return Promise.resolve({ exists: data !== undefined, id: path, data: () => data });
    },
    set: () => {
      state.writes.push(`set ${path}`);
      return Promise.resolve();
    },
    update: () => {
      state.writes.push(`update ${path}`);
      return Promise.resolve();
    },
    delete: () => {
      state.writes.push(`delete ${path}`);
      return Promise.resolve();
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  };
}

function collectionRef(path: string): Record<string, unknown> {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    add: () => {
      state.writes.push(`add ${path}`);
      return Promise.resolve({ id: 'new' });
    },
    where: () => collectionRef(path),
    get: () => {
      state.reads.push(path);
      return Promise.resolve({ docs: [], empty: true, size: 0 });
    },
  };
}

const fakeDb = {
  collection: (name: string) => collectionRef(name),
  doc: (path: string) => docRef(path),
  getAll: (...refs: { get: () => Promise<unknown> }[]) => Promise.all(refs.map((r) => r.get())),
  batch: () => ({
    set: () => state.writes.push('batch.set'),
    update: () => state.writes.push('batch.update'),
    delete: () => state.writes.push('batch.delete'),
    commit: () => Promise.resolve(),
  }),
  runTransaction: () => {
    state.writes.push('transaction');
    return Promise.resolve();
  },
};

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb,
  FieldValue: {
    serverTimestamp: () => '__server_ts__',
    arrayUnion: (...v: unknown[]) => v,
    delete: () => '__delete__',
  },
  Timestamp: { now: () => new Date(), fromDate: (d: Date) => d },
}));
vi.mock('../lib/emailUtils.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendTemplatedEmail: vi.fn(() => {
    state.writes.push('email');
    return Promise.resolve(true);
  }),
}));

const { updateObservationWindow } = await import('./updateObservationWindow.js');
const { resendWindowInvite } = await import('./resendWindowInvite.js');
const { cancelObservationWindow } = await import('./cancelObservationWindow.js');
const { assignObservationFromPreference } = await import('./assignObservationFromPreference.js');

interface Runnable {
  run: (r: unknown) => Promise<unknown>;
}
const run = (fn: unknown, req: Partial<CallableRequest>) => (fn as Runnable).run(req);

const PE = 'pe@orono.k12.mn.us';
const PRINCIPAL = 'principal@orono.k12.mn.us';
const FULL = 'full@orono.k12.mn.us';
const TEACHER = 'teacher@orono.k12.mn.us';
const TARGET = 'target@orono.k12.mn.us';
const WINDOW_PATH = `${COLLECTIONS.observationWindows}/w1`;

function req(email: string, role: string, data: Record<string, unknown>) {
  return { auth: { uid: 'u', token: { email, role } }, data } as unknown as CallableRequest;
}

beforeEach(() => {
  state.reads = [];
  state.writes = [];
  state.docs = {
    [WINDOW_PATH]: {
      windowId: 'w1',
      observerEmail: PE,
      observerName: 'Pat Evaluator',
      bookingMode: 'day-preference',
      status: 'open',
      startDate: '2026-11-02',
      endDate: '2026-11-20',
      invitedEmails: [TARGET],
      invitees: [
        {
          email: TARGET,
          name: 'Tara Target',
          role: 'Teacher',
          year: 4,
          buildings: ['oms'],
          buildingId: 'oms',
          inviteToken: 'tok',
          inviteSentAt: null,
          bookedSlotId: null,
        },
      ],
    },
    [`${COLLECTIONS.staff}/${PE}`]: { role: 'peer-evaluator', isActive: true },
    [`${COLLECTIONS.staff}/${PRINCIPAL}`]: {
      role: 'administrator',
      buildings: ['oms'],
      // Admin Console access must not widen this to other observers' windows.
      hasAdminAccess: true,
      isActive: true,
    },
    [`${COLLECTIONS.staff}/${FULL}`]: { role: 'full-access', isActive: true },
    [`${COLLECTIONS.staff}/${TEACHER}`]: { role: 'teacher', isActive: true },
    [`${COLLECTIONS.staff}/${TARGET}`]: {
      name: 'Tara Target',
      role: 'teacher',
      year: 4,
      buildings: ['oms'],
      isActive: true,
    },
  };
});

describe('building Administrator on another observer’s window', () => {
  it('cannot edit it with updateObservationWindow', async () => {
    await expect(
      run(
        updateObservationWindow,
        req(PRINCIPAL, 'administrator', {
          windowId: 'w1',
          endDate: '2026-12-20',
          addInvitees: [{ email: TEACHER, buildingId: 'oms' }],
          removeInviteeEmails: [TARGET],
          resendInviteEmails: [TARGET],
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.writes).toEqual([]);
  });

  it('cannot resend an invite with resendWindowInvite', async () => {
    await expect(
      run(
        resendWindowInvite,
        req(PRINCIPAL, 'administrator', { windowId: 'w1', email: TARGET, buildingId: 'oms' }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.writes).toEqual([]);
  });

  it('cannot cancel it with cancelObservationWindow', async () => {
    await expect(
      run(cancelObservationWindow, req(PRINCIPAL, 'administrator', { windowId: 'w1' })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.writes).toEqual([]);
  });
});

describe('oversight and the observer still manage the window', () => {
  it('Full Access can resend an invite on someone else’s window', async () => {
    await expect(
      run(
        resendWindowInvite,
        req(FULL, 'full-access', { windowId: 'w1', email: TARGET, buildingId: 'oms' }),
      ),
    ).resolves.toBeDefined();
    expect(state.writes).toContain('email');
  });

  it('the observer can resend an invite on their own window', async () => {
    await expect(
      run(
        resendWindowInvite,
        req(PE, 'peer-evaluator', { windowId: 'w1', email: TARGET, buildingId: 'oms' }),
      ),
    ).resolves.toBeDefined();
    expect(state.writes).toContain('email');
  });
});

describe('assignObservationFromPreference authorizes the caller first', () => {
  const emails = [
    TARGET, // in-building, Probationary
    'archived@orono.k12.mn.us',
    'elsewhere@orono.k12.mn.us',
    'tenured@orono.k12.mn.us',
    'nobody@orono.k12.mn.us', // no staff doc
  ];

  beforeEach(() => {
    // Make the window a building Administrator's, whose scope check is the
    // one that names a blocked assignee and says why.
    state.docs[WINDOW_PATH] = { ...state.docs[WINDOW_PATH], observerEmail: PRINCIPAL };
    state.docs[`${COLLECTIONS.staff}/archived@orono.k12.mn.us`] = {
      name: 'Archie Archived',
      role: 'teacher',
      year: 4,
      buildings: ['oms'],
      isActive: false,
      isArchived: true,
    };
    state.docs[`${COLLECTIONS.staff}/elsewhere@orono.k12.mn.us`] = {
      name: 'Elsie Elsewhere',
      role: 'teacher',
      year: 4,
      buildings: ['ohs'],
      isActive: true,
    };
    state.docs[`${COLLECTIONS.staff}/tenured@orono.k12.mn.us`] = {
      name: 'Ted Tenured',
      role: 'teacher',
      year: 1,
      buildings: ['oms'],
      isActive: true,
    };
  });

  it.each(emails)('a teacher gets the same permission-denied for %s', async (email) => {
    const err = (await run(
      assignObservationFromPreference,
      req(TEACHER, 'teacher', { windowId: 'w1', email, slotId: 'x' }),
    ).catch((e: unknown) => e)) as { code?: string; message?: string };

    expect(err.code).toBe('permission-denied');
    expect(err.message).toBe('Only the window observer or an admin may assign');
    // The assignee's staff doc was never read and nothing was written.
    expect(state.reads).not.toContain(`${COLLECTIONS.staff}/${email}`);
    expect(state.writes).toEqual([]);
  });
});
