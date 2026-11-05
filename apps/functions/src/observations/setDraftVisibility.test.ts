import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const h = vi.hoisted((): { db: unknown } => ({ db: undefined }));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => h.db,
  FieldValue: { serverTimestamp: () => '__server_ts__', delete: () => '__delete__' },
}));

const { setDraftVisibility } = await import('./setDraftVisibility.js');

const run = (req: Partial<CallableRequest>) =>
  (setDraftVisibility as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

const OBS_PATH = `${COLLECTIONS.observations}/obs-1`;
const VIEW_PATH = `${COLLECTIONS.teacherViews}/obs-1`;
const OBSERVER = 'observer@orono.k12.mn.us';
const OBSERVED = 'observed@orono.k12.mn.us';
const PE = 'pe@orono.k12.mn.us';
const OVERSIGHT = 'full@orono.k12.mn.us';

interface Recorder {
  updates: { path: string; data: Record<string, unknown> }[];
  sets: { path: string; data: Record<string, unknown> }[];
  transactions: number;
}

function setup(over: Record<string, unknown> = {}, observation?: Record<string, unknown> | null) {
  const obs =
    observation === undefined
      ? {
          status: OBSERVATION_STATUS.draft,
          observerEmail: OBSERVER,
          observedEmail: OBSERVED,
          coObserverEmails: [PE],
          observationData: { c1: { proficiency: 'proficient' } },
          componentNotes: { c1: 'private note' },
          transcripts: { a1: 'classroom audio' },
          draftVisibility: {
            ratings: true,
            notes: false,
            evidence: false,
            script: false,
            meetingNotes: false,
          },
          ...over,
        }
      : observation;
  const docs: Record<string, Record<string, unknown> | undefined> = {
    [OBS_PATH]: obs ?? undefined,
    [`${COLLECTIONS.staff}/${OVERSIGHT}`]: { role: 'full-access', isActive: true },
    [`${COLLECTIONS.staff}/${PE}`]: { role: 'peer-evaluator', isActive: true },
  };
  const rec: Recorder = { updates: [], sets: [], transactions: 0 };
  const doc = (path: string) => ({
    path,
    get: () => {
      const data = docs[path];
      return Promise.resolve({ exists: data !== undefined, data: () => data });
    },
  });
  h.db = {
    doc,
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
      rec.transactions += 1;
      type Ref = ReturnType<typeof doc>;
      return fn({
        get: (ref: Ref) => ref.get(),
        update: (ref: Ref, data: Record<string, unknown>) =>
          rec.updates.push({ path: ref.path, data }),
        set: (ref: Ref, data: Record<string, unknown>) => rec.sets.push({ path: ref.path, data }),
      });
    },
  };
  return rec;
}

function request(
  data: Record<string, unknown>,
  email = OBSERVER,
  token: Record<string, unknown> = {},
): Partial<CallableRequest> {
  return {
    auth: { uid: 'uid-1', token: { email, ...token } },
    data: { observationId: 'obs-1', ...data },
  } as unknown as Partial<CallableRequest>;
}

beforeEach(() => {
  h.db = undefined;
});

describe('setDraftVisibility', () => {
  it('turns a switch off and drops that content from the teacher view in the same transaction', async () => {
    const rec = setup();
    await expect(run(request({ key: 'ratings', value: false }))).resolves.toMatchObject({
      ok: true,
      draftVisibility: { ratings: false },
    });
    expect(rec.transactions).toBe(1);
    expect(rec.updates).toEqual([
      {
        path: OBS_PATH,
        data: {
          draftVisibility: {
            ratings: false,
            notes: false,
            evidence: false,
            script: false,
            meetingNotes: false,
          },
          lastModifiedAt: '__server_ts__',
        },
      },
    ]);
    expect(rec.sets).toHaveLength(1);
    const view = rec.sets[0];
    expect(view?.path).toBe(VIEW_PATH);
    expect(view?.data).toMatchObject({ observationId: 'obs-1', observedEmail: OBSERVED });
    expect(view?.data).not.toHaveProperty('observationData');
    expect(view?.data).not.toHaveProperty('componentNotes');
    expect(view?.data).not.toHaveProperty('transcripts');
  });

  it('turns a switch on and copies that content into the teacher view', async () => {
    const rec = setup();
    await run(request({ key: 'notes', value: true }));
    expect(rec.sets[0]?.data).toMatchObject({
      componentNotes: { c1: 'private note' },
      observationData: { c1: { proficiency: 'proficient' } },
      draftVisibility: { ratings: true, notes: true },
    });
  });

  it('treats a missing or malformed draftVisibility as all off', async () => {
    const rec = setup({ draftVisibility: { ratings: 'yes' } });
    await run(request({ key: 'script', value: true }));
    expect(rec.updates[0]?.data['draftVisibility']).toEqual({
      ratings: false,
      notes: false,
      evidence: false,
      script: true,
      meetingNotes: false,
    });
  });

  it('lets oversight change sharing on someone else’s observation', async () => {
    const rec = setup();
    await run(request({ key: 'ratings', value: false }, OVERSIGHT, { role: 'full-access' }));
    expect(rec.updates).toHaveLength(1);
  });

  it.each([
    ['the observed teacher', OBSERVED, {}],
    ['a co-observer', PE, { role: 'peer-evaluator' }],
    ['an unrelated user', 'someone@orono.k12.mn.us', {}],
  ])('refuses %s and writes nothing', async (_who, email, token) => {
    const rec = setup();
    await expect(run(request({ key: 'ratings', value: true }, email, token))).rejects.toMatchObject(
      { code: 'permission-denied' },
    );
    expect(rec.updates).toEqual([]);
    expect(rec.sets).toEqual([]);
  });

  it('refuses a Finalized observation', async () => {
    const rec = setup({ status: OBSERVATION_STATUS.finalized });
    await expect(run(request({ key: 'ratings', value: false }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(rec.sets).toEqual([]);
  });

  it('reports a missing observation', async () => {
    setup({}, null);
    await expect(run(request({ key: 'ratings', value: false }))).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it.each([{ key: 'transcripts', value: true }, { key: 'ratings', value: 'off' }, {}])(
    'rejects bad input %o',
    async (data) => {
      setup();
      await expect(run(request(data))).rejects.toMatchObject({ code: 'invalid-argument' });
    },
  );

  it('requires sign-in', async () => {
    setup();
    await expect(
      run({ data: { observationId: 'obs-1', key: 'ratings', value: true } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
