import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const h = vi.hoisted((): { db: unknown } => ({ db: undefined }));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => h.db,
  FieldValue: { serverTimestamp: () => '__server_ts__' },
}));

const { saveTeacherResponse } = await import('./saveTeacherResponse.js');

const run = (req: Partial<CallableRequest>) =>
  (saveTeacherResponse as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

const OBS_PATH = `${COLLECTIONS.observations}/obs-1`;
const OBSERVER = 'observer@orono.k12.mn.us';
const OBSERVED = 'observed@orono.k12.mn.us';
const OVERSIGHT = 'full@orono.k12.mn.us';
const GOALS = { type: 'doc', content: [{ type: 'paragraph' }] };

function setup(over: Record<string, unknown> = {}, observation?: Record<string, unknown> | null) {
  const obs =
    observation === undefined
      ? {
          status: OBSERVATION_STATUS.draft,
          observerEmail: OBSERVER,
          observedEmail: OBSERVED,
          observationData: { c1: { proficiency: 'proficient' } },
          componentNotes: { c1: 'private note' },
          ...over,
        }
      : observation;
  const docs: Record<string, Record<string, unknown> | undefined> = {
    [OBS_PATH]: obs ?? undefined,
    [`${COLLECTIONS.staff}/${OVERSIGHT}`]: { role: 'full-access', isActive: true },
  };
  const updates: { path: string; data: Record<string, unknown> }[] = [];
  const doc = (path: string) => ({
    path,
    get: () => {
      const data = docs[path];
      return Promise.resolve({ exists: data !== undefined, data: () => data });
    },
  });
  h.db = {
    doc,
    runTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: (ref: ReturnType<typeof doc>) => ref.get(),
        update: (ref: ReturnType<typeof doc>, data: Record<string, unknown>) =>
          updates.push({ path: ref.path, data }),
      }),
  };
  return updates;
}

function request(
  data: Record<string, unknown>,
  email = OBSERVED,
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

describe('saveTeacherResponse', () => {
  it('writes only the answers and lastModifiedAt on a Draft', async () => {
    const updates = setup();
    const answer = { questionId: 'q1', answer: 'Mine', updatedAt: '2026-01-02T03:04:05.000Z' };
    await expect(run(request({ workProductAnswers: [answer] }))).resolves.toEqual({ ok: true });
    expect(updates).toEqual([
      {
        path: OBS_PATH,
        data: {
          workProductAnswers: [{ ...answer, updatedAt: new Date(answer.updatedAt) }],
          lastModifiedAt: '__server_ts__',
        },
      },
    ]);
  });

  it('writes the goals response, including clearing it, on a Finalized observation', async () => {
    const updates = setup({ status: OBSERVATION_STATUS.finalized });
    await run(request({ goalsResponse: GOALS }));
    await run(request({ goalsResponse: null }));
    expect(updates.map((u) => u.data)).toEqual([
      { goalsResponse: GOALS, lastModifiedAt: '__server_ts__' },
      { goalsResponse: null, lastModifiedAt: '__server_ts__' },
    ]);
  });

  it('ignores any other field in the input', async () => {
    const updates = setup();
    await run(
      request({
        goalsResponse: GOALS,
        observationData: { c1: { proficiency: 'proficient' } },
        componentNotes: null,
      }),
    );
    expect(Object.keys(updates[0]?.data ?? {}).sort()).toEqual(['goalsResponse', 'lastModifiedAt']);
  });

  it.each([
    ['the observer', OBSERVER, {}],
    ['oversight', OVERSIGHT, { role: 'full-access' }],
    ['an unrelated user', 'someone@orono.k12.mn.us', {}],
  ])('refuses %s and writes nothing', async (_who, email, token) => {
    const updates = setup();
    await expect(run(request({ goalsResponse: GOALS }, email, token))).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(updates).toEqual([]);
  });

  it('lets an observer who is also the observed person save', async () => {
    const updates = setup({ observerEmail: OBSERVED });
    await run(request({ goalsResponse: GOALS }));
    expect(updates).toHaveLength(1);
  });

  it('refuses a missing observation the same way as someone else’s', async () => {
    setup({}, null);
    await expect(run(request({ goalsResponse: GOALS }))).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it.each([
    {},
    { goalsResponse: 'text' },
    { workProductAnswers: [{ questionId: 'q1', answer: 'x', updatedAt: 'not a date' }] },
  ])('rejects bad input %o', async (data) => {
    const updates = setup();
    await expect(run(request(data))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(updates).toEqual([]);
  });

  it('requires sign-in', async () => {
    setup();
    await expect(
      run({ data: { observationId: 'obs-1', goalsResponse: GOALS } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
