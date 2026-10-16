import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';

interface HState {
  db: unknown;
}

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// ---------------------------------------------------------------------------
// Hoisted test state read by the module mocks below.
// ---------------------------------------------------------------------------
const h = vi.hoisted((): HState => ({ db: undefined }));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => h.db,
  FieldValue: {
    serverTimestamp: () => '__server_ts__',
    delete: () => '__delete__',
  },
}));

const { setCoObservers } = await import('./setCoObservers.js');

const run = (req: Partial<CallableRequest>) =>
  (setCoObservers as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

// ---------------------------------------------------------------------------
// Configurable in-memory Firestore fake
// ---------------------------------------------------------------------------

interface DbConfig {
  /** Current observation doc data (null → not found). */
  observation: Record<string, unknown> | null;
  /** Docs keyed by full path for db.doc(path).get(). */
  docs?: Record<string, Record<string, unknown> | undefined>;
}

interface Recorder {
  txUpdates: Record<string, unknown>[];
}

function buildDb(config: DbConfig): { db: unknown; rec: Recorder } {
  const rec: Recorder = { txUpdates: [] };
  const obsPath = `${COLLECTIONS.observations}/obs-1`;

  function doc(path: string) {
    const data = path === obsPath ? (config.observation ?? undefined) : config.docs?.[path];
    return {
      get: () =>
        Promise.resolve({ exists: data !== undefined, id: path.split('/')[1], data: () => data }),
    };
  }

  function runTransaction(fn: (tx: unknown) => Promise<unknown>) {
    const tx = {
      get: (ref: { get: () => Promise<unknown> }) => ref.get(),
      update: (_ref: unknown, patch: Record<string, unknown>) => {
        rec.txUpdates.push(patch);
      },
    };
    return fn(tx);
  }

  return { db: { doc, runTransaction }, rec };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBSERVER = 'observer@orono.k12.mn.us';
const OBSERVED = 'observed@orono.k12.mn.us';
const PE = 'pe@orono.k12.mn.us';
const TEACHER = 'teacher@orono.k12.mn.us';
const INACTIVE_PE = 'gone@orono.k12.mn.us';
const OVERSIGHT = 'full@orono.k12.mn.us';

function draftObservation(over: Record<string, unknown> = {}) {
  return {
    status: OBSERVATION_STATUS.draft,
    observerEmail: OBSERVER,
    observedEmail: OBSERVED,
    coObserverEmails: [],
    ...over,
  };
}

function staffDocs(): Record<string, Record<string, unknown>> {
  return {
    [`${COLLECTIONS.staff}/${PE}`]: { role: 'peer-evaluator', isActive: true },
    [`${COLLECTIONS.staff}/${TEACHER}`]: { role: 'teacher', isActive: true },
    [`${COLLECTIONS.staff}/${INACTIVE_PE}`]: { role: 'peer-evaluator', isActive: false },
    [`${COLLECTIONS.staff}/${OVERSIGHT}`]: { role: 'full-access', isActive: true },
  };
}

function setup(
  obsOver: Record<string, unknown> = {},
  observation?: Record<string, unknown> | null,
) {
  const built = buildDb({
    observation: observation === undefined ? draftObservation(obsOver) : observation,
    docs: staffDocs(),
  });
  h.db = built.db;
  return built.rec;
}

function request(
  coObserverEmails: unknown,
  email = OBSERVER,
  token: Record<string, unknown> = {},
): Partial<CallableRequest> {
  return {
    auth: { uid: 'uid-1', token: { email, ...token } },
    data: { observationId: 'obs-1', coObserverEmails },
  } as unknown as Partial<CallableRequest>;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code });
}

beforeEach(() => {
  h.db = undefined;
});

describe('setCoObservers', () => {
  it('lets the owner add a Peer Evaluator', async () => {
    const rec = setup();
    await expect(run(request([PE]))).resolves.toEqual({ ok: true });
    expect(rec.txUpdates).toEqual([{ coObserverEmails: [PE], lastModifiedAt: '__server_ts__' }]);
  });

  it('normalizes case and drops duplicates', async () => {
    const rec = setup();
    await run(request(['PE@orono.k12.mn.us', PE]));
    expect(rec.txUpdates[0]?.['coObserverEmails']).toEqual([PE]);
  });

  it('rejects adding a teacher and writes nothing', async () => {
    const rec = setup();
    await expect(run(request([TEACHER]))).rejects.toMatchObject({
      code: 'invalid-argument',
      message: `${TEACHER} can't co-observe: only Peer Evaluators, Administrators and Full Access staff can.`,
    });
    expect(rec.txUpdates).toEqual([]);
  });

  it('rejects adding an inactive Peer Evaluator', async () => {
    const rec = setup();
    await expectCode(run(request([INACTIVE_PE])), 'invalid-argument');
    expect(rec.txUpdates).toEqual([]);
  });

  it('rejects adding someone with no staff doc', async () => {
    const rec = setup();
    await expectCode(run(request(['nobody@orono.k12.mn.us'])), 'invalid-argument');
    expect(rec.txUpdates).toEqual([]);
  });

  it('lets the owner remove a legacy non-observer', async () => {
    const rec = setup({ coObserverEmails: [TEACHER, PE] });
    await run(request([PE]));
    expect(rec.txUpdates[0]?.['coObserverEmails']).toEqual([PE]);
  });

  it('keeps a legacy non-observer while adding someone else', async () => {
    const rec = setup({ coObserverEmails: [TEACHER] });
    await run(request([TEACHER, PE]));
    expect(rec.txUpdates[0]?.['coObserverEmails']).toEqual([TEACHER, PE]);
  });

  it('refuses a caller who is neither owner nor oversight', async () => {
    const rec = setup();
    await expectCode(run(request([PE], 'someone@orono.k12.mn.us')), 'permission-denied');
    expect(rec.txUpdates).toEqual([]);
  });

  it('refuses a co-observer changing the list', async () => {
    const rec = setup({ coObserverEmails: [PE] });
    await expectCode(run(request([], PE, { role: 'peer-evaluator' })), 'permission-denied');
    expect(rec.txUpdates).toEqual([]);
  });

  it('lets oversight change co-observers on someone else’s observation', async () => {
    const rec = setup();
    await run(request([PE], OVERSIGHT, { role: 'full-access' }));
    expect(rec.txUpdates[0]?.['coObserverEmails']).toEqual([PE]);
  });

  it('refuses oversight on an observation of themselves', async () => {
    const rec = setup({ observedEmail: OVERSIGHT });
    await expectCode(run(request([PE], OVERSIGHT, { role: 'full-access' })), 'permission-denied');
    expect(rec.txUpdates).toEqual([]);
  });

  it('refuses a Finalized observation', async () => {
    const rec = setup({ status: OBSERVATION_STATUS.finalized });
    await expectCode(run(request([PE])), 'failed-precondition');
    expect(rec.txUpdates).toEqual([]);
  });

  it('returns not-found for a missing observation', async () => {
    setup({}, null);
    await expectCode(run(request([PE])), 'not-found');
  });

  it('rejects the owner’s own email', async () => {
    const rec = setup();
    await expectCode(run(request([OBSERVER])), 'invalid-argument');
    expect(rec.txUpdates).toEqual([]);
  });

  it('rejects the observed teacher’s email', async () => {
    const rec = setup();
    await expectCode(run(request([OBSERVED])), 'invalid-argument');
    expect(rec.txUpdates).toEqual([]);
  });

  it('rejects more than 10 emails', async () => {
    const rec = setup();
    const eleven = Array.from({ length: 11 }, (_, i) => `pe${String(i)}@orono.k12.mn.us`);
    await expectCode(run(request(eleven)), 'invalid-argument');
    expect(rec.txUpdates).toEqual([]);
  });

  it('requires sign-in', async () => {
    setup();
    await expectCode(
      run({ data: { observationId: 'obs-1', coObserverEmails: [] } } as Partial<CallableRequest>),
      'unauthenticated',
    );
  });

  it('confines a demo-edit session to demo staff', async () => {
    const rec = setup();
    await expectCode(
      run(request([PE], OBSERVER, { demoEditBy: 'admin@orono.k12.mn.us' })),
      'permission-denied',
    );
    expect(rec.txUpdates).toEqual([]);
  });
});
