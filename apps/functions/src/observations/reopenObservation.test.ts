import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { OBSERVATION_STATUS } from '@ops/shared';

/**
 * Authorization tests for reopenObservation: oversight (Full Access) only,
 * never on the caller's own evaluation, and never for an archived caller
 * whose token still carries role: 'full-access'.
 */

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

type Docs = Record<string, Record<string, unknown> | undefined>;
const state = vi.hoisted(() => {
  const docs: Docs = {};
  return {
    docs,
    updates: [] as { path: string; patch: Record<string, unknown> }[],
    audit: [] as Record<string, unknown>[],
  };
});

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));

vi.mock('firebase-admin/firestore', () => {
  const docRef = (path: string) => ({
    path,
    get: () =>
      Promise.resolve({ exists: state.docs[path] !== undefined, data: () => state.docs[path] }),
  });
  return {
    FieldValue: { serverTimestamp: () => '__ts__', delete: () => '__delete__' },
    getFirestore: () => ({
      doc: docRef,
      collection: () => ({
        add: (entry: Record<string, unknown>) => {
          state.audit.push(entry);
          return Promise.resolve();
        },
      }),
      runTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          get: (ref: { get: () => Promise<unknown> }) => ref.get(),
          update: (ref: { path: string }, patch: Record<string, unknown>) => {
            state.updates.push({ path: ref.path, patch });
          },
        }),
    }),
  };
});

const { reopenObservation } = await import('./reopenObservation.js');

const run = (req: Partial<CallableRequest>) =>
  (reopenObservation as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

const FA = 'fa@orono.k12.mn.us';

function asFullAccess(email = FA): Partial<CallableRequest> {
  return {
    auth: { uid: 'uid-1', token: { email, role: 'full-access', isAdmin: true } },
    data: { observationId: 'obs1', reason: 'fix typo' },
  } as unknown as Partial<CallableRequest>;
}

function seedObservation(observedEmail: string) {
  state.docs['observations/obs1'] = {
    observerEmail: 'pe@orono.k12.mn.us',
    observedEmail,
    observedName: 'Someone',
    status: OBSERVATION_STATUS.finalized,
  };
}

beforeEach(() => {
  state.docs = { [`staff/${FA}`]: { role: 'full-access', isActive: true } };
  state.updates = [];
  state.audit = [];
});

describe('reopenObservation', () => {
  it("lets Full Access reopen someone else's finalized observation", async () => {
    seedObservation('teacher@orono.k12.mn.us');
    await expect(run(asFullAccess())).resolves.toEqual({ ok: true });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]?.patch['status']).toBe(OBSERVATION_STATUS.draft);
    expect(state.audit).toHaveLength(1);
  });

  it('refuses Full Access reopening an evaluation of themselves, leaving it unchanged', async () => {
    seedObservation(FA);
    await expect(run(asFullAccess())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.updates).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it('refuses an archived caller whose token still says full-access', async () => {
    seedObservation('teacher@orono.k12.mn.us');
    state.docs[`staff/${FA}`] = { role: 'full-access', isActive: false };
    await expect(run(asFullAccess())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.updates).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it('refuses a caller without oversight', async () => {
    seedObservation('teacher@orono.k12.mn.us');
    state.docs['staff/pe@orono.k12.mn.us'] = { role: 'peer-evaluator', isActive: true };
    const req = {
      auth: { uid: 'uid-2', token: { email: 'pe@orono.k12.mn.us', role: 'peer-evaluator' } },
      data: { observationId: 'obs1' },
    } as unknown as Partial<CallableRequest>;
    await expect(run(req)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.updates).toEqual([]);
  });
});
